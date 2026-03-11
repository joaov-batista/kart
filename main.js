// ==========================================
// 1. SETUP GERAL E VARIÁVEIS GLOBAIS (CORRIGIDO)
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

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); 
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(100, 200, 50);
scene.add(dirLight);

// VARIÁVEIS GLOBAIS (Aqui está a correção do lastTime e wins!)
let lastTime = performance.now();
let wins = parseInt(localStorage.getItem('polyWins') || '0');
let screenShake = 0; 
let isRaining = false;
let rainTimer = 0;
let isBlackout = false;
let blackoutTimer = 0;
let camMode = 0; 
let gameState = 'lobby'; 
let localCar = null;
let hasFinished = false;

// Redes e Multiplayer
let peer = null;
let myId = '';
let isHost = false;
let hostConn = null;
let connections = {}; 
let roomPlayers = []; 
let networkCars = {}; 
let trackItems = []; 
let radars = [];
let wallL, wallR;

// ==========================================
// 2. CÉU ESTRELADO E TEXTURAS
// ==========================================
const starsGeo = new THREE.BufferGeometry();
const starsArr = new Float32Array(6000 * 3);
for(let i=0; i<6000; i++) {
    starsArr[i*3] = (Math.random() - 0.5) * 4000;
    starsArr[i*3+1] = Math.random() * 1000 + 100; 
    starsArr[i*3+2] = (Math.random() - 0.5) * 4000;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starsArr, 3));
const starsMat = new THREE.PointsMaterial({color: 0xffffff, size: 2.5, transparent: true, opacity: 0.9});
scene.add(new THREE.Points(starsGeo, starsMat));

function createParticleTex() {
    const cvs = document.createElement('canvas');
    cvs.width = 64; cvs.height = 64;
    const ctx = cvs.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cvs);
}
const particleTex = createParticleTex();

// ==========================================
// 3. VFX MANAGER
// ==========================================
class VFXManager {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.rainSystem = null;
        this.speedLines = [];
    }

    spawn(pos, type, colorVal, forwardVel = new THREE.Vector3()) {
        const isNitro = type.includes('nitro');
        let colorHex = colorVal;
        let isBlack = false;
        let isStardust = false;

        if (colorVal === 'rainbow') {
            const time = performance.now() * 0.005;
            colorHex = (Math.floor(Math.sin(time)*127+128)<<16) | (Math.floor(Math.sin(time+2)*127+128)<<8) | Math.floor(Math.sin(time+4)*127+128);
        } else if (colorVal === '0x111111' || colorVal === 0x111111) {
            isBlack = true; colorHex = 0x111111;
        } else if (colorVal === 'stardust') {
            isStardust = true; colorHex = 0x050510;
        }

        const useAdditive = isNitro && !isBlack && !isStardust;
        const opacityBase = type === 'smoke_light' ? 0.15 : (isNitro ? 1.0 : 0.35);
        
        const mat = new THREE.SpriteMaterial({ 
            map: particleTex, color: colorHex, transparent: true, 
            opacity: opacityBase, blending: useAdditive ? THREE.AdditiveBlending : THREE.NormalBlending
        });
        
        const p = new THREE.Sprite(mat);
        p.position.copy(pos);
        
        const spread = isNitro ? 0.15 : (type === 'smoke_light' ? 0.4 : 1.2);
        p.userData = {
            velocity: new THREE.Vector3((Math.random()-0.5)*spread, (Math.random()-0.5)*spread, isNitro ? Math.random()*2.5 : (Math.random()-0.5)*1.5).add(forwardVel),
            life: opacityBase,
            initialType: type,
            scaleXSpeed: isNitro ? 0.8 : 1.03, scaleYSpeed: isNitro ? 0.8 : 1.03 
        };
        
        const initScale = type === 'smoke_light' ? 1.5 : (isNitro ? 2.5 : 3.5);
        p.scale.set(initScale, initScale, initScale);
        this.scene.add(p);
        this.particles.push(p);

        if (isBlack && Math.random() < 0.6) {
            const light = new THREE.Sprite(new THREE.SpriteMaterial({ map: particleTex, color: 0xffff00, blending: THREE.AdditiveBlending }));
            light.position.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*2, Math.random()*2, (Math.random()-0.5)*2));
            light.userData = { velocity: forwardVel.clone(), life: 0.25, scaleXSpeed: 0.5, scaleYSpeed: 0.5, initialType: 'lightning' };
            this.scene.add(light);
            this.particles.push(light);
        } else if (isStardust && Math.random() < 0.8) {
            const starMat = new THREE.SpriteMaterial({ map: particleTex, color: Math.random()>0.5?0x00ffff:0xffffff, blending: THREE.AdditiveBlending });
            const star = new THREE.Sprite(starMat);
            star.position.copy(pos).add(new THREE.Vector3((Math.random()-0.5)*3, (Math.random()-0.5)*3, (Math.random()-0.5)*3));
            star.userData = { velocity: forwardVel.clone(), life: 0.4, scaleXSpeed: 0.9, scaleYSpeed: 0.9, initialType: 'lightning' };
            star.scale.set(0.6, 0.6, 0.6);
            this.scene.add(star);
            this.particles.push(star);
        }
    }

    createRain() {
        if(this.rainSystem) return;
        const rainGeo = new THREE.BufferGeometry();
        const pos = new Float32Array(6000 * 3);
        for(let i=0;i<6000;i++) {
            pos[i*3] = (Math.random() - 0.5) * 150; pos[i*3+1] = Math.random() * 80; pos[i*3+2] = (Math.random() - 0.5) * 150;
        }
        rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const rainMat = new THREE.PointsMaterial({color: 0x99ccff, size: 0.4, transparent: true, opacity: 0.6});
        this.rainSystem = new THREE.Points(rainGeo, rainMat);
        this.scene.add(this.rainSystem);
    }

    spawnSpeedLine(playerPos) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 15), new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.4}));
        line.position.set(playerPos.x + (Math.random()-0.5)*50, Math.random()*15 + 1, playerPos.z - 80 - Math.random()*40);
        this.scene.add(line);
        this.speedLines.push({mesh: line, life: 1.0});
    }

    update(dt, playerPos, playerSpeed) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.position.addScaledVector(p.userData.velocity, dt * (p.userData.initialType.includes('nitro') ? 25.0 : 5.0));
            p.scale.x *= p.userData.scaleXSpeed; p.scale.y *= p.userData.scaleYSpeed;
            p.material.opacity = p.userData.life;
            p.userData.life -= dt * (p.userData.initialType.includes('nitro') ? 4.5 : 1.5); 
            if (p.userData.life <= 0) { this.scene.remove(p); this.particles.splice(i, 1); }
        }

        if (isRaining && this.rainSystem && playerPos) {
            const pos = this.rainSystem.geometry.attributes.position.array;
            for(let i=0; i<6000; i++) {
                pos[i*3+1] -= 100 * dt; 
                if (pos[i*3+1] < 0) {
                    pos[i*3+1] = 80; 
                    pos[i*3] = playerPos.x + (Math.random() - 0.5) * 150;
                    pos[i*3+2] = playerPos.z - 40 + (Math.random() - 0.5) * 200; 
                }
            }
            this.rainSystem.geometry.attributes.position.needsUpdate = true;
        } else if (!isRaining && this.rainSystem) {
            this.scene.remove(this.rainSystem); this.rainSystem = null;
        }

        if (playerSpeed > 180 && playerPos && Math.random() < 0.5) this.spawnSpeedLine(playerPos);
        for(let i = this.speedLines.length - 1; i >= 0; i--) {
            let sl = this.speedLines[i];
            sl.mesh.position.z += (playerSpeed * 2.5) * dt; 
            sl.life -= dt * 2.5;
            if (sl.life <= 0 || (playerPos && sl.mesh.position.z > playerPos.z + 20)) {
                this.scene.remove(sl.mesh); this.speedLines.splice(i, 1);
            }
        }
    }
}
const vfx = new VFXManager(scene);

function spawnNetworkVFX(pos, type, color, vel = new THREE.Vector3()) {
    vfx.spawn(pos, type, color, vel);
    if(gameState === 'playing') {
        broadcastNetwork({ action: 'vfx', pos: {x:pos.x, y:pos.y, z:pos.z}, type, color, vel: {x:vel.x, y:vel.y, z:vel.z} });
    }
}

// ==========================================
// 4. CLASSE DO CARRO E FÍSICA
// ==========================================
const CAR_DATA = {
    'mustang.gltf': { accel: 130, topSpeed: 210, nitro: 100, skillDesc: 'Tiro Paralisante', spdBar: '70%', accBar: '80%', nitBar: '70%' },
    'charger.gltf': { accel: 140, topSpeed: 230, nitro: 80, skillDesc: 'Boost Debilitante', spdBar: '80%', accBar: '95%', nitBar: '50%' },
    'porsche911.gltf': { accel: 120, topSpeed: 240, nitro: 100, skillDesc: 'Fumaça Cegante', spdBar: '95%', accBar: '70%', nitBar: '70%' },
    'mustangmach1.gltf': { accel: 135, topSpeed: 220, nitro: 130, skillDesc: 'Arremesso Aéreo', spdBar: '75%', accBar: '85%', nitBar: '95%' }
};

class Car {
    constructor(modelName, plate, nitroColor, isLocal) {
        this.modelName = modelName;
        this.isLocal = isLocal;
        this.nitroColor = nitroColor;
        this.mesh = new THREE.Group();
        scene.add(this.mesh);
        
        this.health = 100;
        this.nitro = 100;
        this.speed = 0;
        this.vy = 0; 
        this.pitch = 0; 
        this.steering = 0; 
        
        this.headlightsOn = false;
        this.headlightToggleCd = 0;
        this.isDead = false;
        this.isDrifting = false;
        this.boostTimer = 0; 
        this.dashTimer = 0; 
        this.stunTimer = 0; 
        this.skillCooldown = 0;
        this.emoteActive = false;
        this.emoteTimer = 0;
        
        this.exhaustNodes = [];
        this.wheels = [];
        this.rearLWheel = null;
        this.rearRWheel = null;
        this.lightsNodes = [];

        new THREE.GLTFLoader().load(`models/${this.modelName}`, (gltf) => {
            gltf.scene.rotation.y = Math.PI; 
            this.mesh.add(gltf.scene);
            gltf.scene.traverse((child) => {
                const name = child.name.toLowerCase();
                if (name.includes("escapamento")) this.exhaustNodes.push(child);
                if (name.includes("roda")) this.wheels.push(child);
                if (name.includes("roda_fundo_esquerda")) this.rearLWheel = child;
                if (name.includes("roda_fundo_direita")) this.rearRWheel = child;
                
                if (name.includes("farol_") && name.includes("frente")) {
                    const sl = new THREE.SpotLight(0xffffff, 0, 3000, Math.PI/3, 0.2, 1);
                    child.add(sl);
                    const target = new THREE.Object3D();
                    target.position.set(0, 0, 30); 
                    child.add(target);
                    sl.target = target;
                    this.lightsNodes.push(sl);
                }
            });
        });
    }

    updateLocal(dt, keys, carData, plate) {
        if (this.isDead) return;

        let maxN = carData.nitro;
        let baseSpd = carData.topSpeed;
        if (plate.toUpperCase() === "UNB10") { maxN += 50; baseSpd += 30; }

        if (this.wheels.length > 0) this.wheels.forEach(w => w.rotation.x -= this.speed * dt * 0.08);

        if (this.headlightToggleCd > 0) this.headlightToggleCd -= dt;
        if (keys.l && this.headlightToggleCd <= 0) {
            this.headlightsOn = !this.headlightsOn;
            this.headlightToggleCd = 0.5;
            this.lightsNodes.forEach(l => l.intensity = this.headlightsOn ? 1000 : 0); 
        }

        if (this.skillCooldown > 0) this.skillCooldown -= dt;
        if (this.boostTimer > 0) this.boostTimer -= dt;
        this.nitro = Math.min(maxN, this.nitro + 12 * dt);

        if (this.stunTimer > 0) {
            this.stunTimer -= dt;
            this.speed = THREE.MathUtils.lerp(this.speed, 0, dt * 2); 
            return;
        }

        if (this.dashTimer > 0) {
            this.dashTimer -= dt;
            this.speed = THREE.MathUtils.lerp(this.speed, 600, dt * 10); 
            this.useNitro(dt, true);
        } else if (keys.m1 && this.nitro >= 20) {
            keys.m1 = false;
            this.dashTimer = 0.3; 
            this.nitro -= 20;
            screenShake = 6; 
        }

        if (keys.e && this.skillCooldown <= 0 && this.nitro >= 30 && this.dashTimer <= 0) {
            keys.e = false; this.nitro -= 30; this.skillCooldown = 5.0; this.triggerSpecial();
        }

        if (keys.r && !this.emoteActive && this.nitro >= 20 && this.dashTimer <= 0 && this.vy === 0) {
            this.emoteActive = true; this.emoteTimer = 0; this.nitro -= 20;
        }

        if (this.emoteActive) {
            this.emoteTimer += dt;
            const ease = Math.sin((this.emoteTimer / 1.5) * Math.PI); 
            if (this.modelName === 'mustang.gltf') {
                this.mesh.children[0].rotation.x = (this.emoteTimer / 1.5) * (Math.PI * 2);
                this.mesh.position.y = ease * 4 + 1;
            } else if (this.modelName === 'charger.gltf') {
                this.mesh.children[0].rotation.x = (this.emoteTimer / 2.0) * (Math.PI * 6);
                this.mesh.position.y = ease * 5 + 1;
            } else if (this.modelName === 'porsche911.gltf') {
                this.mesh.rotation.y += 35 * dt; this.emitSmokeFromTires(); this.useNitro(dt);
            } else if (this.modelName === 'mustangmach1.gltf') {
                this.mesh.position.y += 20 * dt; this.useNitro(dt, true);
            }
            if (this.emoteTimer >= 1.5) { this.emoteActive = false; this.mesh.children[0].rotation.x = 0; this.mesh.position.y = 1; }
            return;
        }

        let currentMax = baseSpd * Math.max(0.4, (this.health / 100)); 
        if (this.boostTimer > 0) currentMax = 350; 

        if (keys.w && this.dashTimer <= 0) this.speed += carData.accel * dt; 
        else if (keys.s && this.dashTimer <= 0) this.speed -= (carData.accel * 1.5) * dt; 
        else this.speed -= this.speed * 0.5 * dt; 
        
        if (keys.f) this.speed = THREE.MathUtils.lerp(this.speed, 0, dt * 5); 

        if (this.dashTimer <= 0) {
            if (this.speed > currentMax) this.speed = THREE.MathUtils.lerp(this.speed, currentMax, dt * 2);
            this.speed = Math.max(-40, this.speed);
        }

        if (keys[' '] && this.dashTimer <= 0) this.useNitro(dt);
        if (keys.q) { this.speed = 10; this.mesh.rotation.y += 7.0 * dt; this.emitSmokeFromTires(); }
        if (this.speed > 80 && !this.isDrifting && Math.random() < 0.3) this.emitLightSmoke();

        const grip = Math.max(0.4, 1.0 - (this.speed / 500));
        let maxTurnSpeed = 2.5 * grip; 
        let slideVector = 0; 
        
        this.isDrifting = keys.shift && this.speed > 80;
        if (this.isDrifting) {
            maxTurnSpeed = 4.0 * grip; 
            this.emitSmokeFromTires();
        }

        if (isRaining) {
            maxTurnSpeed *= 0.6; 
            slideVector = (keys.a ? 1 : (keys.d ? -1 : 0)) * (this.speed * 0.7); 
            if (this.speed > 200 && this.isDrifting && (keys.a || keys.d)) {
                showEventMsg("AQUAPLANAGEM!", 0xffaa00); this.takeDamage(100); 
            }
        }

        let targetSteer = 0;
        if (keys.a) targetSteer = maxTurnSpeed;
        if (keys.d) targetSteer = -maxTurnSpeed;
        
        this.steering += (targetSteer - this.steering) * 8 * dt;
        this.mesh.rotateY(this.steering * dt);

        this.mesh.translateZ(-this.speed * dt);
        if (slideVector !== 0) this.mesh.translateX(slideVector * dt);
        
        if (this.mesh.position.x > 38) { this.mesh.position.x = 38; this.speed *= 0.9; }
        if (this.mesh.position.x < -38) { this.mesh.position.x = -38; this.speed *= 0.9; }
        
        this.mesh.children[0].rotation.x += (this.pitch - this.mesh.children[0].rotation.x) * 5 * dt;
        this.vy -= 100 * dt; 
        this.mesh.position.y += this.vy * dt;
        if (this.mesh.position.y <= 1) { this.mesh.position.y = 1; this.vy = 0; this.pitch = 0; }
    }

    emitLightSmoke() {
        const left = this.mesh.position.clone().add(new THREE.Vector3(-1.2, -0.5, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));
        const right = this.mesh.position.clone().add(new THREE.Vector3(1.2, -0.5, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));
        spawnNetworkVFX(left, 'smoke_light', 0xaaaaaa); spawnNetworkVFX(right, 'smoke_light', 0xaaaaaa);
    }
    emitSmokeFromTires() {
        const left = this.mesh.position.clone().add(new THREE.Vector3(-1.2, -0.5, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));
        const right = this.mesh.position.clone().add(new THREE.Vector3(1.2, -0.5, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));
        spawnNetworkVFX(left, 'smoke', 0xaaaaaa); spawnNetworkVFX(right, 'smoke', 0xaaaaaa);
    }

    useNitro(dt, forceBlack = false) {
        if (this.nitro > 0) {
            this.speed += 300 * dt; 
            this.speed = Math.min(this.speed, 420); 
            this.nitro -= 45 * dt; 
            let emitPos = new THREE.Vector3();
            if (this.exhaustNodes.length > 0) this.exhaustNodes[0].getWorldPosition(emitPos);
            else emitPos = this.mesh.position.clone().add(new THREE.Vector3(0, 0.2, 2.5).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix)));

            const backwards = new THREE.Vector3(0,0,1).applyMatrix4(new THREE.Matrix4().extractRotation(this.mesh.matrix));
            const isMach1 = this.modelName === 'mustangmach1.gltf' || forceBlack;
            spawnNetworkVFX(emitPos, isMach1 ? 'nitro_black' : 'nitro', isMach1 ? '0x111111' : this.nitroColor, backwards);
            if(!isMach1 && this.nitroColor !== 'stardust') spawnNetworkVFX(emitPos, 'nitro_core', 0xffffff, backwards); 
            
            if (this.speed > 250) screenShake = Math.min(2.0, screenShake + 0.2);
        }
    }

    triggerSpecial() {
        showEventMsg("ESPECIAL ATIVADO!", 0x00ffff);
        let targetId = null; let minDist = 150; 
        for(let id in networkCars) {
            let dist = networkCars[id].mesh.position.distanceTo(this.mesh.position);
            if(dist < minDist) { minDist = dist; targetId = id; }
        }
        if (targetId) broadcastNetwork({ action: 'specialHit', target: targetId, model: this.modelName });
    }

    takeDamage(amount) {
        if (this.isDead) return;
        this.health -= amount;
        screenShake = 6; 
        this.mesh.traverse((c) => { if (c.isMesh) c.material.emissive.setHex(0xff0000); });
        setTimeout(() => { this.mesh.traverse((c) => { if (c.isMesh) c.material.emissive.setHex(0x000000); }); }, 150);
        if (this.health <= 0) this.breakdown();
    }

    breakdown() {
        this.isDead = true; this.speed = 0; this.mesh.rotation.z = Math.PI / 3; 
        const ui = document.getElementById('repairScreen');
        ui.style.display = 'flex';
        let t = 5;
        const int = setInterval(() => {
            t--; document.getElementById('repairTimer').innerText = t;
            if (t <= 0) {
                clearInterval(int); this.isDead = false; this.health = 100;
                this.mesh.rotation.z = 0; ui.style.display = 'none';
            }
        }, 1000);
    }
}

// ==========================================
// 5. GERAÇÃO DE PISTA MULTIPLAYER (Sincronizada e com Neon)
// ==========================================
function generateTrackData() {
    const data = [];
    for(let i=1; i<200; i++) {
        const zPos = -i * 140; const rand = Math.random();
        if (rand < 0.2) data.push({ id: i, type: 'ramp', x: (Math.random()-0.5)*40, z: zPos, width: 20, depth: 15 });
        else if (rand < 0.3) data.push({ id: i, type: 'health', x: (Math.random()-0.5)*50, z: zPos, width: 6, depth: 6 });
        else if (rand < 0.5) data.push({ id: i, type: 'slow', x: (Math.random()-0.5)*40, z: zPos, width: 30, depth: 30 });
        else if (rand < 0.55) data.push({ id: i, type: 'boost', x: (Math.random()-0.5)*40, z: zPos, width: 20, depth: 40 });
        else if (rand < 0.9) data.push({ id: i, type: 'damage', damage: 40, x: (Math.random()-0.5)*50, z: zPos, width: 25, depth: 5 });
        if (i % 10 === 0) radars.push(zPos);
    }
    return data;
}

function buildTrackFromData(data) {
    const trackGeo = new THREE.PlaneGeometry(80, 30000);
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.rotation.x = -Math.PI / 2; track.position.z = -15000; scene.add(track);

    // PAREDES NEON VISÍVEIS
    const wallGeo = new THREE.BoxGeometry(2, 20, 30000);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xff0055, wireframe: true, transparent: true, opacity: 1.0, emissive: 0xff0055, emissiveIntensity: 1.0 }); 
    wallL = new THREE.Mesh(wallGeo, wallMat); wallL.position.set(-41, 10, -15000); scene.add(wallL);
    wallR = new THREE.Mesh(wallGeo, wallMat); wallR.position.set(41, 10, -15000); scene.add(wallR);

    const finishLine = new THREE.Mesh(new THREE.PlaneGeometry(80, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, map: createCheckeredTex() }));
    finishLine.rotation.x = -Math.PI/2; finishLine.position.set(0, 0.2, -28000); scene.add(finishLine);

    data.forEach(item => {
        let mesh;
        if (item.type === 'ramp') {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(item.width, 4, item.depth), new THREE.MeshStandardMaterial({ color: 0xffff00 }));
            mesh.position.set(item.x, 1.0, item.z); mesh.rotation.x = 0.3; 
        } else if (item.type === 'health') {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(item.width, 6, item.depth), new THREE.MeshStandardMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 }));
            mesh.position.set(item.x, 3, item.z);
        } else if (item.type === 'slow') {
            mesh = new THREE.Mesh(new THREE.PlaneGeometry(item.width, item.depth), new THREE.MeshStandardMaterial({ color: 0x331100 }));
            mesh.rotation.x = -Math.PI / 2; mesh.position.set(item.x, 0.2, item.z);
        } else if (item.type === 'boost') {
            mesh = new THREE.Mesh(new THREE.PlaneGeometry(item.width, item.depth), new THREE.MeshStandardMaterial({ color: 0x00e5ff }));
            mesh.rotation.x = -Math.PI / 2; mesh.position.set(item.x, 0.2, item.z);
        } else if (item.type === 'damage') {
            mesh = new THREE.Mesh(new THREE.BoxGeometry(item.width, 10, item.depth), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
            mesh.position.set(item.x, 5, item.z);
        }
        scene.add(mesh);
        trackItems.push({ ...item, mesh });
    });

    radars.forEach(zPos => {
        const radar = new THREE.Mesh(new THREE.BoxGeometry(80, 2, 2), new THREE.MeshBasicMaterial({ color: 0xffaa00 }));
        radar.position.set(0, 15, zPos); scene.add(radar);
    });
}

function createCheckeredTex() {
    const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 256; const ctx = cvs.getContext('2d');
    for(let i=0; i<4; i++) { for(let j=0; j<4; j++) { ctx.fillStyle = (i+j)%2===0 ? '#fff' : '#000'; ctx.fillRect(i*64, j*64, 64, 64); } }
    const tex = new THREE.CanvasTexture(cvs); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(10, 4); return tex;
}

// ==========================================
// 6. REDE E LOBBY (EXPOSITOR GIGANTE)
// ==========================================
const keys = {};
window.addEventListener('keydown', e => { if(e.key === 'F1') { e.preventDefault(); camMode = camMode === 0 ? 1 : 0; } keys[e.key.toLowerCase()] = true; if(e.key === ' ') keys[' '] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if(e.key === ' ') keys[' '] = false; });
window.addEventListener('mousedown', e => { if(e.button === 0) keys.m1 = true; });
window.addEventListener('mouseup', e => { if(e.button === 0) keys.m1 = false; });

const touchMap = { 'btnLeft': 'a', 'btnRight': 'd', 'btnGas': 'w', 'btnBrake': 'f', 'btnNitro': ' ', 'btnDrift': 'shift', 'btnSpec': 'e', 'btnDash': 'm1' };
for(let id in touchMap) {
    const el = document.getElementById(id);
    if(el) {
        el.addEventListener('touchstart', (e) => { e.preventDefault(); keys[touchMap[id]] = true; });
        el.addEventListener('touchend', (e) => { e.preventDefault(); keys[touchMap[id]] = false; });
    }
}

function initLobby() {
    document.getElementById('btnHost').onclick = setupHost;
    document.getElementById('btnJoin').onclick = setupClient;
    document.getElementById('btnStart').onclick = () => { 
        const trackData = generateTrackData();
        broadcastNetwork({action: 'start', trackData}); 
        startGame(trackData); 
    };
    
    document.getElementById('winBadge').innerText = `VITÓRIAS: ${wins}`;
    if (wins >= 10) document.getElementById('optStardust').style.display = 'block';

    const select = document.getElementById('carSelect');
    select.addEventListener('change', () => {
        const data = CAR_DATA[select.value];
        document.getElementById('cardName').innerText = select.options[select.selectedIndex].text;
        document.getElementById('cardSkill').innerText = `ESPECIAL (E): ${data.skillDesc}`;
        document.getElementById('barSpd').style.width = data.spdBar;
        document.getElementById('barAcc').style.width = data.accBar;
        document.getElementById('barNit').style.width = data.nitBar;

        if(select.value === 'mustangmach1.gltf') document.getElementById('optNitroBlack').style.display = 'block';
        else { document.getElementById('optNitroBlack').style.display = 'none'; if(document.getElementById('nitroSelect').value === '0x111111') document.getElementById('nitroSelect').value = '0x00ffff'; }
    });

    // PÓDIO E LUZES NFS HEAT
    const pGroup = new THREE.Group(); pGroup.position.set(12, -4, -18); // Posicionado à direita
    
    // Geometria de túnel neon
    const neonMat = new THREE.MeshBasicMaterial({color: 0x00e5ff});
    const pinkMat = new THREE.MeshBasicMaterial({color: 0xff0055});
    for(let i=0; i<8; i++) {
        const hex = new THREE.Mesh(new THREE.TorusGeometry(12, 0.2, 4, 6), i%2===0?neonMat:pinkMat);
        hex.position.set(0, 5, -5 - (i*8));
        hex.rotation.z = Math.PI/2;
        pGroup.add(hex);
    }
    
    pGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(10, 11, 2, 64), new THREE.MeshStandardMaterial({color: 0x111111, metalness: 0.9, roughness: 0.1})));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10.2, 0.3, 16, 100), new THREE.MeshBasicMaterial({color: 0x00e5ff}));
    ring.rotation.x = Math.PI/2; ring.position.y = 1; pGroup.add(ring); scene.add(pGroup);

    const sl1 = new THREE.SpotLight(0x00e5ff, 8.0, 200, Math.PI/3, 0.5, 1); sl1.position.set(5, 20, -5); sl1.target.position.set(12, 0, -18);
    const sl2 = new THREE.SpotLight(0xff0055, 8.0, 200, Math.PI/3, 0.5, 1); sl2.position.set(20, 20, -5); sl2.target.position.set(12, 0, -18);
    scene.add(sl1); scene.add(sl1.target); scene.add(sl2); scene.add(sl2.target);

    function loadLobbyCar() {
        if(window.lobbyCar) pGroup.remove(window.lobbyCar);
        new THREE.GLTFLoader().load(`models/${select.value}`, (gltf) => {
            window.lobbyCar = gltf.scene; window.lobbyCar.scale.set(5.5, 5.5, 5.5); window.lobbyCar.position.set(0, 1.2, 0); pGroup.add(window.lobbyCar);
        });
    }
    select.addEventListener('change', loadLobbyCar); loadLobbyCar();
    window.lobbyPodium = pGroup;
}

function setupHost() {
    isHost = true; myId = Math.floor(100000 + Math.random() * 900000).toString();
    peer = new Peer(myId);
    peer.on('open', id => {
        document.getElementById('btnHost').style.display = 'none'; document.getElementById('btnJoin').style.display = 'none';
        document.getElementById('joinCode').style.display = 'none'; document.getElementById('roomInfo').style.display = 'block';
        document.getElementById('btnStart').style.display = 'block'; document.getElementById('displayCode').innerText = id;
        addPlayerToList(id, document.getElementById('playerName').value || 'Host');
    });
    peer.on('connection', conn => { connections[conn.peer] = conn; conn.on('data', data => handleNetworkData(data, conn.peer)); });
}

function setupClient() {
    const code = document.getElementById('joinCode').value; if(!code) return;
    peer = new Peer();
    peer.on('open', id => {
        myId = id; hostConn = peer.connect(code);
        hostConn.on('open', () => {
            document.getElementById('btnHost').style.display = 'none'; document.getElementById('btnJoin').style.display = 'none';
            document.getElementById('joinCode').style.display = 'none'; document.getElementById('roomInfo').style.display = 'block';
            document.getElementById('displayCode').innerText = code;
            hostConn.send({action: 'join', name: document.getElementById('playerName').value || 'Player', car: document.getElementById('carSelect').value });
        });
        hostConn.on('data', data => handleNetworkData(data, code));
    });
}

function handleNetworkData(data, senderId) {
    if (isHost) {
        if (data.action === 'join') { addPlayerToList(senderId, data.name); broadcastNetwork({action: 'lobbySync', players: roomPlayers}); }
        if (data.action === 'update' || data.action === 'vfx' || data.action === 'specialHit' || data.action === 'consumeItem') { broadcastNetwork(data, senderId); applyNetworkData(data, senderId); }
    } else {
        if (data.action === 'lobbySync') { document.getElementById('playerList').innerHTML = ''; data.players.forEach(p => addPlayerToList(p.id, p.name, true)); }
        if (data.action === 'start') startGame(data.trackData);
        if (data.action === 'triggerEvent') triggerEventSync(data.event);
        if (data.action === 'update' || data.action === 'vfx' || data.action === 'specialHit' || data.action === 'consumeItem') applyNetworkData(data, senderId);
    }
}

function broadcastNetwork(data, ignoreId = null) {
    if (isHost) { for(let id in connections) { if(id !== ignoreId && connections[id].open) connections[id].send(data); } } 
    else if (hostConn && hostConn.open) { hostConn.send(data); }
}

function applyNetworkData(data, senderId) {
    if(data.action === 'update') {
        if(!networkCars[data.id]) networkCars[data.id] = new Car(data.car, 'NET', data.nitro, false);
        networkCars[data.id].mesh.position.set(data.x, data.y, data.z); networkCars[data.id].mesh.rotation.y = data.rotY; networkCars[data.id].mesh.children[0].rotation.x = data.rotX;
    }
    if(data.action === 'vfx') vfx.spawn(new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z), data.type, data.color, new THREE.Vector3(data.vel.x, data.vel.y, data.vel.z));
    
    if(data.action === 'specialHit' && data.target === myId) {
        showEventMsg("VOCÊ FOI ATINGIDO!", 0xff0000); screenShake = 8;
        if(data.model === 'mustang.gltf') { spawnNetworkVFX(localCar.mesh.position, 'lightning', 0x00ffff); localCar.stunTimer = 1.0; }
        if(data.model === 'charger.gltf') localCar.stunTimer = 1.0;
        if(data.model === 'porsche911.gltf') { document.getElementById('smokeScreen').style.display='block'; setTimeout(()=>document.getElementById('smokeScreen').style.display='none', 1000); }
        if(data.model === 'mustangmach1.gltf') localCar.vy = 60;
    }

    if(data.action === 'consumeItem') {
        const index = trackItems.findIndex(i => i.id === data.itemId);
        if(index > -1) { scene.remove(trackItems[index].mesh); trackItems.splice(index, 1); }
    }
}

function triggerEventSync(type) {
    if(type === 'rain') { rainTimer = 15; isRaining = true; vfx.createRain(); showEventMsg("CHUVA! PISTA ESCORREGADIA!", 0x0055ff); }
    if(type === 'blackout') { blackoutTimer = 15; isBlackout = true; document.getElementById('blackoutAlert').style.display = 'block'; }
}

function addPlayerToList(id, name, isSync = false) {
    if(!isSync) roomPlayers.push({id, name, car: document.getElementById('carSelect').value });
    const li = document.createElement('li'); li.innerHTML = `<span>[ON]</span> ${name}`;
    document.getElementById('playerList').appendChild(li);
}

function startGame(trackData) {
    gameState = 'playing';
    document.getElementById('lobbyUI').style.display = 'none'; document.getElementById('gameUI').style.display = 'block';
    
    if(window.lobbyPodium) scene.remove(window.lobbyPodium);
    
    buildTrackFromData(trackData);
    localCar = new Car(document.getElementById('carSelect').value, document.getElementById('playerPlate').value, document.getElementById('nitroSelect').value, true);
    localCar.mesh.position.set((Math.random()-0.5)*20, 1, 0); 
}

// ==========================================
// 7. POLICE MANAGER E RADARES
// ==========================================
let policeCar = null; let policeActive = false; let policeTimer = 0;

function checkRadarLogic(carPos, speed) {
    if (policeActive) { document.getElementById('radarAlert').style.display = 'none'; return; }
    let nearRadar = false;
    for (let rZ of radars) {
        const dist = carPos.z - rZ; 
        if (dist > 0 && dist < 500) { nearRadar = true; document.getElementById('radarAlert').style.display = 'block'; }
        if (dist < 0 && dist > -30 && speed > 150) { spawnPolice(carPos); document.getElementById('radarAlert').style.display = 'none'; break; }
    }
    if (!nearRadar) document.getElementById('radarAlert').style.display = 'none';
}

function spawnPolice(pos) {
    policeActive = true; policeTimer = 25; 
    showEventMsg("CÓDIGO 3! VIATURA NA COLA!", 0xff0000);
    document.getElementById('policeFlash').style.display = 'block'; 
    new THREE.GLTFLoader().load('models/police.gltf', (gltf) => {
        policeCar = gltf.scene; policeCar.rotation.y = Math.PI; policeCar.position.set(pos.x, 1, pos.z + 100); scene.add(policeCar);
    });
}

function updatePolice(dt, playerMesh) {
    if (!policeActive || !policeCar) return;
    policeTimer -= dt;
    
    const targetPos = playerMesh.position.clone();
    const lookAtMatrix = new THREE.Matrix4().lookAt(policeCar.position, targetPos, new THREE.Vector3(0,1,0));
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookAtMatrix);
    policeCar.quaternion.slerp(targetQuat, dt * 1.5); 
    
    policeCar.translateZ((localCar.speed + 15) * dt); 

    if (policeCar.position.distanceTo(playerMesh.position) < 6) {
        if (localCar.dashTimer > 0) {
            showEventMsg("VIATURA DESTRUÍDA!", 0x00e5ff); despawnPolice(); screenShake = 10;
        } else {
            localCar.takeDamage(15); localCar.speed *= 0.85; screenShake = 8;
            policeCar.position.x += (Math.random() - 0.5) * 15; policeCar.position.z += 20; 
        }
    }
    if (policeTimer <= 0 || policeCar.position.distanceTo(playerMesh.position) > 400) {
        showEventMsg("POLÍCIA DESPISTADA", 0x00ff00); despawnPolice();
    }
}

function despawnPolice() {
    if (policeCar) scene.remove(policeCar);
    policeActive = false; policeCar = null; document.getElementById('policeFlash').style.display = 'none';
}

function showEventMsg(msg, colorHex) {
    const el = document.getElementById('eventText'); el.innerText = msg; el.style.color = '#' + colorHex.toString(16).padStart(6, '0');
    el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 3000);
}

// ==========================================
// 8. MAIN GAME LOOP
// ==========================================
let eventCheckTimer = 0;

function gameLoop() {
    requestAnimationFrame(gameLoop);
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1); 
    lastTime = now;

    if (gameState === 'lobby') {
        vfx.update(dt, null, 0);
        if(window.lobbyPodium) window.lobbyPodium.rotation.y += 0.8 * dt; 
        camera.position.set(0, 4, 0); camera.lookAt(12, 3, -18); 
    } 
    else if (gameState === 'playing' && localCar) {
        
        if (isHost) {
            eventCheckTimer -= dt;
            if (eventCheckTimer <= 0) {
                eventCheckTimer = 5.0; 
                if (Math.random() < 0.05 && !isRaining && !isBlackout) {
                    const eType = Math.random() > 0.5 ? 'rain' : 'blackout';
                    triggerEventSync(eType); broadcastNetwork({action: 'triggerEvent', event: eType});
                }
            }
        }

        if (blackoutTimer > 0) {
            blackoutTimer -= dt;
            scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, 0.05, dt * 2);
            ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, 0.05, dt * 2); dirLight.intensity = THREE.MathUtils.lerp(dirLight.intensity, 0.0, dt * 2);
            if (blackoutTimer <= 0) { isBlackout = false; document.getElementById('blackoutAlert').style.display = 'none'; }
        } else {
            scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, 0.003, dt * 2);
            ambientLight.intensity = THREE.MathUtils.lerp(ambientLight.intensity, 0.9, dt * 2); dirLight.intensity = THREE.MathUtils.lerp(dirLight.intensity, 1.8, dt * 2);
        }

        if (rainTimer > 0) {
            rainTimer -= dt;
            if (rainTimer <= 0) { isRaining = false; showEventMsg("O TEMPO ABRIU", 0xffffff); }
        }

        const carData = CAR_DATA[localCar.modelName];
        localCar.updateLocal(dt, keys, carData, document.getElementById('playerPlate').value);
        
        broadcastNetwork({ 
            action: 'update', id: myId, 
            x: localCar.mesh.position.x, y: localCar.mesh.position.y, z: localCar.mesh.position.z, 
            rotY: localCar.mesh.rotation.y, rotX: localCar.mesh.children[0].rotation.x,
            car: localCar.modelName, nitro: localCar.nitroColor 
        });

        for(let id in networkCars) {
            let oCar = networkCars[id];
            if(oCar.mesh.position.distanceTo(localCar.mesh.position) < 4) {
                localCar.speed *= 0.8; screenShake = 4;
                localCar.mesh.position.x += (localCar.mesh.position.x > oCar.mesh.position.x ? 2 : -2); 
            }
        }

        vfx.update(dt, localCar.mesh.position, localCar.speed); 
        checkRadarLogic(localCar.mesh.position, localCar.speed);
        updatePolice(dt, localCar.mesh);

        const cx = localCar.mesh.position.x;
        const cz = localCar.mesh.position.z;

        for (let i = trackItems.length - 1; i >= 0; i--) {
            const item = trackItems[i];
            if (Math.abs(cx - item.x) < (item.width/2 + 2) && Math.abs(cz - item.z) < (item.depth/2 + 2)) {
                if (item.type === 'ramp' && localCar.vy === 0) { 
                    localCar.vy = 45; localCar.pitch = -0.3; localCar.speed += 30; 
                } else if (item.type === 'slow') { localCar.speed *= 0.96; 
                } else if (item.type === 'boost') { localCar.boostTimer = 3.0; localCar.speed += 50; 
                } else if (item.type === 'health') { 
                    localCar.health = Math.min(100, localCar.health + 50); scene.remove(item.mesh); trackItems.splice(i, 1);
                    broadcastNetwork({action: 'consumeItem', itemId: item.id});
                } else if (item.type === 'damage') {
                    if (localCar.dashTimer > 0) { scene.remove(item.mesh); trackItems.splice(i, 1); screenShake = 6; broadcastNetwork({action: 'consumeItem', itemId: item.id}); } 
                    else { localCar.takeDamage(item.damage); localCar.speed *= 0.3; scene.remove(item.mesh); trackItems.splice(i, 1); broadcastNetwork({action: 'consumeItem', itemId: item.id}); }
                }
            }
        }

        if (localCar.mesh.position.z < -28000 && !hasFinished) {
            hasFinished = true; wins++; localStorage.setItem('polyWins', wins);
            showEventMsg(`VITÓRIA! TOTAL: ${wins}`, 0xfacc15);
            setTimeout(() => window.location.reload(), 4000);
        }

        let idealCamPos = new THREE.Vector3(); let lookAtPos = new THREE.Vector3();
        if (camMode === 1) { 
            idealCamPos = localCar.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0.5).applyMatrix4(new THREE.Matrix4().extractRotation(localCar.mesh.matrix)));
            lookAtPos = localCar.mesh.position.clone().add(new THREE.Vector3(0, 1.0, -20).applyMatrix4(new THREE.Matrix4().extractRotation(localCar.mesh.matrix)));
            camera.position.copy(idealCamPos); 
        } else { 
            let camOffset = new THREE.Vector3(0, 1.5, 3.5); 
            if (localCar.isDrifting) camOffset = new THREE.Vector3(keys.a ? -2.0 : 2.0, 1.5, 3.0); 
            if (localCar.emoteActive) camOffset = new THREE.Vector3(0, 6, 12); 
            
            idealCamPos = localCar.mesh.position.clone().add(camOffset.applyMatrix4(new THREE.Matrix4().extractRotation(localCar.mesh.matrix)));
            lookAtPos = localCar.mesh.position.clone().add(new THREE.Vector3(0, 0.6, 0));
            camera.position.lerp(idealCamPos, dt * 15); 
        }
        
        if (screenShake > 0) {
            camera.position.x += (Math.random()-0.5) * screenShake; camera.position.y += (Math.random()-0.5) * screenShake;
            screenShake *= 0.9; if (screenShake < 0.1) screenShake = 0;
        }

        const targetFov = camMode === 1 ? 90 + (localCar.speed / 6) : 75 + (localCar.speed / 5); 
        camera.fov += (Math.min(120, targetFov) - camera.fov) * (dt * 5);
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