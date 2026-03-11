// ==========================================
// 1. VARIÁVEIS GLOBAIS E SETUP (LUZES AUMENTADAS)
// ==========================================
const canvas = document.getElementById('bgCanvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020205, 0.003);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 20000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ILUMINAÇÃO GERAL DO MAPA MAIS FORTE
const ambientLight = new THREE.AmbientLight(0xffffff, 2.0); scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 3.5); dirLight.position.set(100, 200, 50); scene.add(dirLight);

const keys = {}; 
let lastTime = performance.now();
let wins = parseInt(localStorage.getItem('polyWins') || '0');
let screenShake = 0; 
let gameState = 'lobby'; 
let localCar = null;

let peer = null;
let myId = '';
let isHost = false;
let hostConn = null;
let connections = {}; 
let roomPlayers = []; 
let networkCars = {}; 
let trackItems = []; 
let radars = [];
let localPlayerName = '';

const MAX_SPEED_CAP = 150;
const TRACK_END = -18000;

// Input (Adicionado o F para freio)
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if(e.key === ' ') keys[' '] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if(e.key === ' ') keys[' '] = false; });
window.addEventListener('mousedown', e => { if(e.button === 0) keys.m1 = true; });
window.addEventListener('mouseup', e => { if(e.button === 0) keys.m1 = false; });

// ==========================================
// 2. LOBBY 3D (MAIS ILUMINADO)
// ==========================================
let lobbyPodium = new THREE.Group();
let lobbyCarMesh = null;

function initLobby3D() {
    lobbyPodium.position.set(8, -2, -12); 
    scene.add(lobbyPodium);

    const neonMat = new THREE.MeshBasicMaterial({color: 0x00e5ff});
    const pinkMat = new THREE.MeshBasicMaterial({color: 0xff0055});
    for(let i=0; i<6; i++) {
        const hex = new THREE.Mesh(new THREE.TorusGeometry(8, 0.1, 4, 6), i%2===0?neonMat:pinkMat);
        hex.position.set(0, 4, -4 - (i*6));
        hex.rotation.z = Math.PI/2;
        lobbyPodium.add(hex);
    }

    // REFLETORES DO EXPOSITOR BOMBANDO
    const sl1 = new THREE.SpotLight(0x00e5ff, 15.0, 100, Math.PI/3, 0.5, 1); 
    sl1.position.set(0, 15, 0); sl1.target.position.set(8, 0, -12);
    
    const sl2 = new THREE.SpotLight(0xff0055, 10.0, 100, Math.PI/3, 0.5, 1); 
    sl2.position.set(15, 15, -10); sl2.target.position.set(8, 0, -12);
    
    scene.add(sl1); scene.add(sl1.target);
    scene.add(sl2); scene.add(sl2.target);

    document.getElementById('carSelect').addEventListener('change', loadLobbyCar);
    loadLobbyCar();
}

function loadLobbyCar() {
    if(lobbyCarMesh) lobbyPodium.remove(lobbyCarMesh);
    const model = document.getElementById('carSelect').value;
    new THREE.GLTFLoader().load(`models/${model}`, (gltf) => {
        lobbyCarMesh = gltf.scene;
        lobbyCarMesh.scale.set(4.5, 4.5, 4.5); // Carro levemente maior no lobby
        lobbyCarMesh.position.set(0, 0.5, 0);
        lobbyPodium.add(lobbyCarMesh);
    });

    const options = document.getElementById('carSelect').options;
    document.getElementById('cardName').innerText = options[document.getElementById('carSelect').selectedIndex].text.split('(')[0];
    document.getElementById('cardSkill').innerText = options[document.getElementById('carSelect').selectedIndex].text.split('(')[1].replace(')','');
}

initLobby3D(); 

// ==========================================
// 3. VFX (PARTÍCULAS)
// ==========================================
function createParticleTex() {
    const cvs = document.createElement('canvas'); cvs.width = 64; cvs.height = 64;
    const ctx = cvs.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cvs);
}
const particleTex = createParticleTex();

class VFXManager {
    constructor(scene) { this.scene = scene; this.particles = []; }
    spawn(pos, type, colorVal, forwardVel = new THREE.Vector3()) {
        let colorHex = colorVal === 'rainbow' ? 0xffffff : colorVal; 
        const isNitro = type.includes('nitro');
        const opacityBase = type === 'smoke' ? 0.3 : (isNitro ? 1.0 : 0.5);
        
        const mat = new THREE.SpriteMaterial({ 
            map: particleTex, color: colorHex, transparent: true, 
            opacity: opacityBase, blending: type === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending
        });
        
        const p = new THREE.Sprite(mat); p.position.copy(pos);
        const spread = isNitro ? 0.2 : 1.5;
        p.userData = { velocity: new THREE.Vector3((Math.random()-0.5)*spread, (Math.random()-0.5)*spread, isNitro ? Math.random()*2 : (Math.random()-0.5)*1.5).add(forwardVel), life: opacityBase, isNitro: isNitro };
        
        const initScale = isNitro ? 2.5 : 4.0; p.scale.set(initScale, initScale, initScale);
        this.scene.add(p); this.particles.push(p);
    }
    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.position.addScaledVector(p.userData.velocity, dt * (p.userData.isNitro ? 20.0 : 8.0));
            p.scale.x *= p.userData.isNitro ? 0.8 : 1.05; p.scale.y *= p.userData.isNitro ? 0.8 : 1.05;
            p.material.opacity = p.userData.life;
            p.userData.life -= dt * (p.userData.isNitro ? 4.0 : 1.5); 
            if (p.userData.life <= 0) { this.scene.remove(p); this.particles.splice(i, 1); }
        }
    }
}
const vfx = new VFXManager(scene);

// ==========================================
// 4. CLASSE CARRO E FÍSICA
// ==========================================
class Car {
    constructor(modelName, nitroColor) {
        this.modelName = modelName; this.nitroColor = nitroColor;
        this.mesh = new THREE.Group(); scene.add(this.mesh);
        
        this.health = 100; this.nitro = 100; this.speed = 0; this.steering = 0; this.vy = 0; 
        this.isDead = false; this.dashTimer = 0; this.skillCooldown = 0; this.emoteActive = false; this.emoteTimer = 0;
        this.isDrifting = false; this.isUsingNitro = false; this.finished = false;
        this.dashTarget = null; 

        new THREE.GLTFLoader().load(`models/${this.modelName}`, (gltf) => {
            gltf.scene.rotation.y = Math.PI; 
            gltf.scene.scale.set(1.4, 1.4, 1.4); 
            this.mesh.add(gltf.scene);
        });
    }

    updateLocal(dt, keys) {
        if (this.isDead) return;
        this.isDrifting = false; this.isUsingNitro = false;
        this.nitro = Math.min(100, this.nitro + 5 * dt);
        if (this.dashTimer > 0) this.dashTimer -= dt;
        if (this.skillCooldown > 0) this.skillCooldown -= dt;

        // [M1] DASH SEMI-TARGET
        if (keys.m1 && this.nitro >= 20 && this.dashTimer <= 0) {
            keys.m1 = false; this.dashTimer = 0.5; this.nitro -= 20; this.speed += 150; screenShake = 5;
            let closestId = null; let minDist = 200;
            for(let id in networkCars) {
                let dz = this.mesh.position.z - networkCars[id].mesh.position.z; 
                let d = this.mesh.position.distanceTo(networkCars[id].mesh.position);
                if (dz > 0 && d < minDist) { minDist = d; closestId = id; }
            }
            if(closestId) this.dashTarget = networkCars[closestId].mesh;
        }

        if (this.dashTimer > 0 && this.dashTarget) {
            let dx = this.dashTarget.position.x - this.mesh.position.x;
            this.mesh.position.x += dx * dt * 3; 
        } else { this.dashTarget = null; }

        // [E] ESPECIAL (FULL TARGET)
        if (keys.e && this.skillCooldown <= 0 && this.nitro >= 30) {
            keys.e = false; this.skillCooldown = 5; this.nitro -= 30;
            let closestId = null; let minDist = 300;
            for(let id in networkCars) {
                let dz = this.mesh.position.z - networkCars[id].mesh.position.z;
                if (dz > 0 && dz < minDist) { minDist = dz; closestId = id; }
            }
            if (closestId) {
                document.getElementById('eventText').innerText = "ESPECIAL FIXADO NO ALVO!"; 
                if(gameState === 'playing') broadcastNetwork({ action: 'specialHit', target: closestId, sender: myId });
            } else {
                document.getElementById('eventText').innerText = "ESPECIAL: NENHUM ALVO À FRENTE!"; 
            }
            document.getElementById('eventText').style.display = 'block';
            setTimeout(()=> document.getElementById('eventText').style.display = 'none', 1500);
        }

        // [R] EMOTE
        if (keys.r && !this.emoteActive && this.speed > 50 && this.vy === 0) { this.emoteActive = true; this.emoteTimer = 0; }
        if (this.emoteActive) {
            this.emoteTimer += dt;
            if(this.mesh.children[0]) this.mesh.children[0].rotation.x = (this.emoteTimer / 1.0) * (Math.PI * 2);
            if (this.emoteTimer >= 1.0) { this.emoteActive = false; if(this.mesh.children[0]) this.mesh.children[0].rotation.x = 0; }
        }

        // [Q] ZERINHO 
        if (keys.q && this.vy === 0) { 
            this.speed = 0; this.mesh.rotation.y += 10.0 * dt; this.isDrifting = true; this.isUsingNitro = true; 
        }

        // Aceleração Básica e Freio (F)
        if (this.dashTimer <= 0 && !keys.q) {
            if (keys.w) this.speed += 80 * dt; 
            else if (keys.s) this.speed -= 100 * dt; 
            else this.speed -= this.speed * 0.5 * dt; 

            // NOVO: Freio Forte no F
            if (keys.f) {
                this.speed -= 250 * dt;
                this.isDrifting = true; // Frear bruscamente solta fumaça
            }

            if (this.speed > MAX_SPEED_CAP) this.speed = THREE.MathUtils.lerp(this.speed, MAX_SPEED_CAP, dt * 5);
        }

        this.speed = Math.max(-30, this.speed);

        // [ESPAÇO] NITRO
        if (keys[' '] && this.nitro > 0 && this.dashTimer <= 0 && !keys.q) {
            this.speed += 120 * dt; this.speed = Math.min(this.speed, MAX_SPEED_CAP + 40); this.nitro -= 40 * dt; this.isUsingNitro = true;
            if (this.speed > MAX_SPEED_CAP) screenShake = Math.min(1.0, screenShake + 0.1);
        }

        const grip = Math.max(0.4, 1.0 - (this.speed / 200));
        let maxTurnSpeed = 2.5 * grip; 
        if (keys.shift && this.speed > 50) { this.isDrifting = true; maxTurnSpeed = 4.0 * grip; }

        let targetSteer = 0;
        if (keys.a && !keys.q) targetSteer = maxTurnSpeed; if (keys.d && !keys.q) targetSteer = -maxTurnSpeed;
        
        this.steering += (targetSteer - this.steering) * 8 * dt;
        this.mesh.rotateY(this.steering * dt); 
        this.mesh.translateZ(-this.speed * dt);
        
        if (this.mesh.position.x > 38) { this.mesh.position.x = 38; this.speed *= 0.9; }
        if (this.mesh.position.x < -38) { this.mesh.position.x = -38; this.speed *= 0.9; }

        // Gravidade e Pulos
        this.vy -= 100 * dt; 
        this.mesh.position.y += this.vy * dt;
        if (this.mesh.position.y <= 1.0) { 
            this.mesh.position.y = 1.0; 
            this.vy = 0; 
            if(!this.emoteActive && this.mesh.children[0]) this.mesh.children[0].rotation.x = THREE.MathUtils.lerp(this.mesh.children[0].rotation.x, 0, dt * 10);
        }

        this.processVFX();
    }

    processVFX() {
        const backwards = new THREE.Vector3(0,0,1).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix));
        if (this.isUsingNitro) {
            const emitPos = this.mesh.position.clone().add(new THREE.Vector3(0, 0.5, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));
            vfx.spawn(emitPos, 'nitro', this.nitroColor, backwards);
        }
        if (this.isDrifting) {
            const left = this.mesh.position.clone().add(new THREE.Vector3(-1.4, 0, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));
            const right = this.mesh.position.clone().add(new THREE.Vector3(1.4, 0, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));
            vfx.spawn(left, 'smoke', 0xaaaaaa); vfx.spawn(right, 'smoke', 0xaaaaaa);
        }
    }

    takeDamage(amount) {
        if (this.isDead) return;
        this.health -= amount; screenShake = 8; 
        if (this.health <= 0) this.breakdown();
    }

    breakdown() {
        this.isDead = true; this.speed = 0; this.mesh.rotation.z = Math.PI / 3; 
        document.getElementById('repairScreen').style.display = 'flex';
        let t = 5;
        const int = setInterval(() => {
            t--; document.getElementById('repairTimer').innerText = t;
            if (t <= 0) { clearInterval(int); this.isDead = false; this.health = 100; this.mesh.rotation.z = 0; document.getElementById('repairScreen').style.display = 'none'; }
        }, 1000);
    }
}

// ==========================================
// 5. GERAÇÃO DE PISTA COM IDENTIFICADORES DE RADAR
// ==========================================
function createCheckeredTex() {
    const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 256; const ctx = cvs.getContext('2d');
    for(let i=0; i<4; i++) { for(let j=0; j<4; j++) { ctx.fillStyle = (i+j)%2===0 ? '#fff' : '#000'; ctx.fillRect(i*64, j*64, 64, 64); } }
    const tex = new THREE.CanvasTexture(cvs); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(20, 4); return tex;
}

function generateTrackData() {
    const data = [];
    for(let i=1; i<200; i++) {
        const zPos = -i * 100; const rand = Math.random();
        
        if (rand < 0.1) data.push({ id: i, type: 'wall_v', x: (Math.random()-0.5)*50, z: zPos, width: 15, depth: 3 }); 
        else if (rand < 0.2) data.push({ id: i, type: 'wall_h', x: 0, z: zPos, width: 25, depth: 3 }); 
        else if (rand < 0.35) data.push({ id: i, type: 'ramp', x: (Math.random()-0.5)*40, z: zPos, width: 15, depth: 20 });
        else if (rand < 0.45) data.push({ id: i, type: 'health', x: (Math.random()-0.5)*50, z: zPos, width: 6, depth: 6 });
        else if (rand < 0.6) data.push({ id: i, type: 'damage', damage: 35, x: (Math.random()-0.5)*50, z: zPos, width: 20, depth: 5 });
        
        if (i % 20 === 0) radars.push(zPos);
    }
    return data;
}

function buildTrackFromData(data) {
    const trackGeo = new THREE.PlaneGeometry(80, 25000);
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.rotation.x = -Math.PI / 2; track.position.z = -12000; scene.add(track);

    const wallGeo = new THREE.BoxGeometry(2, 10, 25000);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x00e5ff, emissiveIntensity: 0.8, wireframe: true }); 
    const wallL = new THREE.Mesh(wallGeo, wallMat); wallL.position.set(-41, 5, -12000); scene.add(wallL);
    const wallR = new THREE.Mesh(wallGeo, wallMat); wallR.position.set(41, 5, -12000); scene.add(wallR);

    const finishMesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 20), new THREE.MeshBasicMaterial({color: 0xffffff, map: createCheckeredTex()}));
    finishMesh.rotation.x = -Math.PI / 2; finishMesh.position.set(0, 0.1, TRACK_END); scene.add(finishMesh);

    data.forEach(item => {
        let mesh;
        if (item.type === 'health') {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(item.width, 6, item.depth), new THREE.MeshStandardMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 }));
            mesh.position.set(item.x, 3, item.z);
        } else if (item.type === 'damage' || item.type === 'wall_v' || item.type === 'wall_h') {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(item.width, 10, item.depth), new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x550000 }));
            mesh.position.set(item.x, 5, item.z);
        } else if (item.type === 'ramp') {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(item.width, 4, item.depth), new THREE.MeshStandardMaterial({ color: 0xffff00 }));
            mesh.position.set(item.x, 1.0, item.z); mesh.rotation.x = 0.25; 
        }
        scene.add(mesh); trackItems.push({ ...item, mesh });
    });

    // IDENTIFICADOR VISUAL DO RADAR (PÓRTICO NEON AMARELO)
    radars.forEach(zPos => {
        const radarMat = new THREE.MeshBasicMaterial({color: 0xffaa00, wireframe: true});
        const radarLeft = new THREE.Mesh(new THREE.BoxGeometry(2, 20, 2), radarMat); radarLeft.position.set(-39, 10, zPos);
        const radarRight = new THREE.Mesh(new THREE.BoxGeometry(2, 20, 2), radarMat); radarRight.position.set(39, 10, zPos);
        const radarTop = new THREE.Mesh(new THREE.BoxGeometry(80, 2, 2), radarMat); radarTop.position.set(0, 20, zPos);
        scene.add(radarLeft); scene.add(radarRight); scene.add(radarTop);
    });
}

// ==========================================
// 6. REDE E MULTIPLAYER
// ==========================================
const peerConfig = { host: '0.peerjs.com', port: 443, path: '/', secure: true, pingInterval: 5000 };

function initLobby() {
    document.getElementById('winBadge').innerText = `VITÓRIAS: ${wins}`;
    document.getElementById('btnHost').onclick = setupHost;
    document.getElementById('btnJoin').onclick = setupClient;
    document.getElementById('btnStartMatch').onclick = () => { 
        if(!isHost) return;
        const trackData = generateTrackData();
        broadcastNetwork({action: 'start', trackData}); 
        startGame(trackData); 
    };
}

function getPlayerName() {
    let name = document.getElementById('playerName').value.trim();
    if (!name) name = "Piloto_" + Math.floor(Math.random() * 1000);
    return name;
}

function enterWaitingRoom(code) {
    gameState = 'waiting';
    document.getElementById('setupSection').style.display = 'none';
    document.getElementById('waitingRoomSection').style.display = 'block';
    document.getElementById('displayRoomCode').innerText = code;
}

function setupHost() {
    isHost = true; myId = Math.floor(100000 + Math.random() * 900000).toString(); localPlayerName = getPlayerName();
    peer = new Peer(myId, peerConfig);
    peer.on('open', id => { enterWaitingRoom(id); document.getElementById('btnStartMatch').style.display = 'block'; addPlayerToList(id, localPlayerName); });
    peer.on('connection', conn => { connections[conn.peer] = conn; conn.on('data', data => handleNetworkData(data, conn.peer)); });
}

function setupClient() {
    const code = document.getElementById('joinCode').value.trim().toUpperCase(); 
    if(!code) return alert("Digite o código!");
    localPlayerName = getPlayerName();
    peer = new Peer(undefined, peerConfig);
    peer.on('open', id => {
        myId = id; hostConn = peer.connect(code);
        hostConn.on('open', () => { enterWaitingRoom(code); document.getElementById('waitingText').style.display = 'block'; hostConn.send({action: 'join', name: localPlayerName, car: document.getElementById('carSelect').value }); });
        hostConn.on('data', data => handleNetworkData(data, code));
        hostConn.on('close', () => { alert("A sala fechou."); window.location.reload(); });
    });
}

function handleNetworkData(data, senderId) {
    if (isHost) {
        if (data.action === 'join') { addPlayerToList(senderId, data.name); broadcastNetwork({action: 'lobbySync', players: roomPlayers}); }
        if (data.action === 'update' || data.action === 'consumeItem' || data.action === 'specialHit') { broadcastNetwork(data, senderId); applyNetworkData(data); }
    } else {
        if (data.action === 'lobbySync') { document.getElementById('playerList').innerHTML = ''; roomPlayers = data.players; data.players.forEach(p => addPlayerToList(p.id, p.name, true)); }
        if (data.action === 'start') startGame(data.trackData);
        if (data.action === 'update' || data.action === 'consumeItem' || data.action === 'specialHit') applyNetworkData(data);
    }
}

function broadcastNetwork(data, ignoreId = null) {
    if (isHost) { for(let id in connections) { if(id !== ignoreId && connections[id].open) connections[id].send(data); } } 
    else if (hostConn && hostConn.open) { hostConn.send(data); }
}

function applyNetworkData(data) {
    if(data.action === 'update') {
        if(!networkCars[data.id]) networkCars[data.id] = new Car(data.car, data.nitroCol);
        let oCar = networkCars[data.id];
        oCar.mesh.position.set(data.x, data.y, data.z); oCar.mesh.rotation.y = data.rotY; 
        if(oCar.mesh.children[0]) oCar.mesh.children[0].rotation.x = data.rotX;
        oCar.isDrifting = data.isDrifting; oCar.isUsingNitro = data.isUsingNitro;
    }
    if(data.action === 'consumeItem' && isHost === false) { 
        const index = trackItems.findIndex(i => i.id === data.itemId);
        if(index > -1) { scene.remove(trackItems[index].mesh); trackItems.splice(index, 1); }
    }
    if(data.action === 'specialHit' && data.target === myId) {
        localCar.speed *= 0.4; document.getElementById('smokeScreen').style.display='block'; screenShake = 8;
        setTimeout(()=>document.getElementById('smokeScreen').style.display='none', 1000);
    }
}

function addPlayerToList(id, name, isSync = false) {
    if(!isSync) roomPlayers.push({id, name});
    const li = document.createElement('li'); li.innerHTML = `<span>[ON]</span> ${name}`;
    document.getElementById('playerList').appendChild(li);
}

function startGame(trackData) {
    gameState = 'playing';
    document.getElementById('lobbyUI').style.display = 'none'; document.getElementById('gameUI').style.display = 'block';
    if(lobbyPodium) scene.remove(lobbyPodium);
    buildTrackFromData(trackData);
    localCar = new Car(document.getElementById('carSelect').value, document.getElementById('nitroSelect').value);
    localCar.mesh.position.set((Math.random()-0.5)*20, 1.0, 0); 
}

// ==========================================
// 7. POLÍCIA E RADAR
// ==========================================
let policeCar = null; let policeActive = false; let policeTimer = 0;

function checkRadarLogic() {
    let near = false;
    for (let rZ of radars) {
        let dist = localCar.mesh.position.z - rZ;
        if (dist > 0 && dist < 400) {
            near = true;
            document.getElementById('radarAlert').innerText = `⚠️ RADAR ${(dist).toFixed(0)}m! LIMITE: 130 KM/H ⚠️`;
            document.getElementById('radarAlert').style.display = 'block';
        }
        if (dist < 0 && dist > -50 && localCar.speed > 130 && !policeActive) {
            spawnPolice(localCar.mesh.position);
        }
    }
    if (!near && !policeActive) document.getElementById('radarAlert').style.display = 'none';
}

function spawnPolice(pos) {
    policeActive = true; policeTimer = 15; 
    document.getElementById('policeFlash').style.display = 'block'; 
    document.getElementById('eventText').innerText = "RADAR ESTOUROU! POLÍCIA!"; document.getElementById('eventText').style.display = 'block';
    setTimeout(()=> document.getElementById('eventText').style.display = 'none', 2000);
    new THREE.GLTFLoader().load('models/police.gltf', (gltf) => {
        policeCar = gltf.scene; policeCar.rotation.y = Math.PI; 
        policeCar.scale.set(1.4, 1.4, 1.4);
        policeCar.position.set(pos.x, 1.0, pos.z + 100); scene.add(policeCar);
    });
}

function updatePolice(dt, playerMesh) {
    if (!policeActive || !policeCar) return;
    policeTimer -= dt; 
    policeCar.lookAt(playerMesh.position); 
    policeCar.translateZ((localCar.speed + 15) * dt); 

    if (policeCar.position.distanceTo(playerMesh.position) < 8) {
        localCar.takeDamage(15); 
        localCar.speed *= 0.7; screenShake = 8;
        policeCar.position.x += (Math.random() - 0.5) * 20; policeCar.position.z += 30; 
    }

    if (policeTimer <= 0) {
        scene.remove(policeCar); policeActive = false; policeCar = null; document.getElementById('policeFlash').style.display = 'none';
    }
}

// ==========================================
// 8. LOOP PRINCIPAL (COLISÕES CORRIGIDAS)
// ==========================================
let collisionCooldown = 0;

function gameLoop() {
    requestAnimationFrame(gameLoop);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1); 
    lastTime = now;

    if (gameState === 'lobby' || gameState === 'waiting') {
        lobbyPodium.rotation.y += 0.5 * dt; 
        camera.position.set(0, 5, 0); camera.lookAt(8, 2, -12); 
    }
    else if (gameState === 'playing' && localCar) {
        localCar.updateLocal(dt, keys);
        vfx.update(dt); 
        for(let id in networkCars) { networkCars[id].processVFX(); }
        
        let rotX = 0; if (localCar.mesh.children[0]) rotX = localCar.mesh.children[0].rotation.x;
        broadcastNetwork({ 
            action: 'update', id: myId, x: localCar.mesh.position.x, y: localCar.mesh.position.y, z: localCar.mesh.position.z, 
            rotY: localCar.mesh.rotation.y, rotX: rotX, car: localCar.modelName, nitroCol: localCar.nitroColor,
            isDrifting: localCar.isDrifting, isUsingNitro: localCar.isUsingNitro
        });

        checkRadarLogic();
        updatePolice(dt, localCar.mesh);

        // Animação das Paredes Móveis
        const timeOffset = now * 0.002;
        trackItems.forEach(item => {
            if (item.type === 'wall_h') item.mesh.position.x = Math.sin(timeOffset + item.id) * 20;
            if (item.type === 'wall_v') item.mesh.position.y = Math.abs(Math.sin(timeOffset + item.id)) * 10;
        });

        // ==========================================
        // COLISÕES COM OBSTÁCULOS E RAMPAS (MÓVEIS)
        // ==========================================
        const cx = localCar.mesh.position.x; 
        const cz = localCar.mesh.position.z;
        const cy = localCar.mesh.position.y;

        for (let i = trackItems.length - 1; i >= 0; i--) {
            const item = trackItems[i];
            
            // Posição Dinâmica da Malha (Corrige colisão da parede móvel)
            const itemX = item.mesh.position.x;
            const itemY = item.mesh.position.y;
            const itemZ = item.mesh.position.z;

            if (Math.abs(cx - itemX) < (item.width/2 + 2) && Math.abs(cz - itemZ) < (item.depth/2 + 2)) {
                
                if (item.type === 'ramp' && localCar.vy === 0) {
                    localCar.vy = 40; 
                    if(localCar.mesh.children[0]) localCar.mesh.children[0].rotation.x = -0.2; 
                } 
                else if (item.type === 'health') { 
                    localCar.health = Math.min(100, localCar.health + 50); scene.remove(item.mesh); trackItems.splice(i, 1);
                    broadcastNetwork({action: 'consumeItem', itemId: item.id});
                } 
                else if (item.type === 'damage' || item.type === 'wall_v' || item.type === 'wall_h') {
                    
                    // Lógica para não bater se passar "por baixo" da parede vertical ou "por cima" de um pulo
                    if (item.type === 'wall_v' && Math.abs(cy - itemY) > 5) continue; 
                    if (item.type !== 'wall_v' && cy > itemY + 5) continue; 

                    localCar.takeDamage(35); localCar.speed *= 0.3; scene.remove(item.mesh); trackItems.splice(i, 1); 
                    broadcastNetwork({action: 'consumeItem', itemId: item.id}); 
                }
            }
        }

        if (collisionCooldown > 0) collisionCooldown -= dt;
        for (let id in networkCars) {
            let oCar = networkCars[id];
            if (localCar.mesh.position.distanceTo(oCar.mesh.position) < 5.0 && collisionCooldown <= 0) {
                localCar.takeDamage(10); localCar.speed *= 0.6; screenShake = 8;
                localCar.mesh.position.x += (localCar.mesh.position.x > oCar.mesh.position.x ? 3 : -3);
                localCar.mesh.position.z += 3;
                collisionCooldown = 1.0; 
            }
        }

        if (localCar.mesh.position.z < TRACK_END && !localCar.finished) {
            localCar.finished = true;
            document.getElementById('eventText').innerText = "🏁 CORRIDA FINALIZADA! 🏁";
            document.getElementById('eventText').style.display = 'block';
            wins++; localStorage.setItem('polyWins', wins);
            setTimeout(() => window.location.reload(), 5000);
        }

        let camOffset = new THREE.Vector3(0, 3.5, 8.0); 
        if (localCar.isDrifting) camOffset = new THREE.Vector3(keys.a ? -2.5 : 2.5, 3.5, 7.0); 
        
        let idealCamPos = localCar.mesh.position.clone().add(camOffset.applyMatrix4(new THREE.Matrix4().extractRotation(localCar.mesh.matrix)));
        let lookAtPos = localCar.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0));
        
        camera.position.lerp(idealCamPos, dt * 10); 
        
        if (screenShake > 0) {
            camera.position.x += (Math.random()-0.5) * screenShake; camera.position.y += (Math.random()-0.5) * screenShake;
            screenShake *= 0.9; 
        }

        const targetFov = Math.min(95, 75 + (localCar.speed / 15)); 
        camera.fov += (targetFov - camera.fov) * dt * 5; 
        camera.updateProjectionMatrix(); camera.lookAt(lookAtPos);

        document.getElementById('speedVal').innerText = Math.floor(Math.abs(localCar.speed));
        document.getElementById('healthBar').style.width = localCar.health + '%';
        document.getElementById('nitroVal').innerText = Math.floor(localCar.nitro);
        document.getElementById('skillCdBar').style.width = ((5.0 - localCar.skillCooldown) / 5.0) * 100 + '%';
    }
    renderer.render(scene, camera);
}

initLobby();
gameLoop();