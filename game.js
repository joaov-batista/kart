// Configuração do Three.js (Scene, Camera, Renderer) idêntica à anterior...
const items = [];
const obstacles = [];
let policeCar = null;
let policeActive = false;

function buildTrack() {
    // Pista principal
    const trackGeo = new THREE.PlaneGeometry(80, 20000);
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const track = new THREE.Mesh(trackGeo, trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.z = -10000;
    scene.add(track);

    // Muros Laterais Neon
    const wallGeo = new THREE.BoxGeometry(2, 5, 20000);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x00ffff, emissiveIntensity: 0.2 });
    const wallLeft = new THREE.Mesh(wallGeo, wallMat);
    wallLeft.position.set(-41, 2.5, -10000);
    scene.add(wallLeft);
    const wallRight = wallLeft.clone();
    wallRight.position.set(41, 2.5, -10000);
    scene.add(wallRight);

    // Gerar Obstáculos e Itens
    for(let i=1; i<200; i++) {
        const zPos = -i * 100;
        
        // 30% de chance de obstáculo (Barreira)
        if (Math.random() < 0.3) {
            const obs = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 2), new THREE.MeshStandardMaterial({ color: 0xff3333 }));
            obs.position.set((Math.random() - 0.5) * 70, 2, zPos);
            scene.add(obs);
            obstacles.push({ mesh: obs, type: 'barrier', damage: 20 });
        }
        
        // 20% de chance de Item
        if (Math.random() < 0.2) {
            const isHealth = Math.random() < 0.5;
            const geo = isHealth ? new THREE.BoxGeometry(2, 2, 2) : new THREE.CylinderGeometry(1, 1, 3);
            const mat = new THREE.MeshStandardMaterial({ color: isHealth ? 0x00ff00 : 0x0000ff, emissive: isHealth ? 0x00ff00 : 0x0000ff });
            const item = new THREE.Mesh(geo, mat);
            item.position.set((Math.random() - 0.5) * 70, 1.5, zPos - 20);
            scene.add(item);
            items.push({ mesh: item, type: isHealth ? 'health' : 'nitro' });
        }
    }
}

// Evento de Perseguição Policial
function triggerPoliceEvent() {
    if (policeActive) return;
    policeActive = true;
    showEvent("ALERTA: PERSEGUIÇÃO POLICIAL!", 0xff0000);
    
    // Supondo que police.gltf já esteja pre-carregado
    const loader = new THREE.GLTFLoader();
    loader.load(`models/police.gltf`, (gltf) => {
        policeCar = gltf.scene;
        policeCar.position.copy(localCar.mesh.position);
        policeCar.position.z += 50; // Nasce atrás
        scene.add(policeCar);
        
        setTimeout(() => {
            scene.remove(policeCar);
            policeActive = false;
            policeCar = null;
        }, 20000); // Foge em 20 seg
    });
}

function showEvent(text, colorHex) {
    const el = document.getElementById('eventText');
    el.innerText = text;
    el.style.color = '#' + colorHex.toString(16).padStart(6, '0');
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 3000);
}

function checkCollisions() {
    if (localCar.isDead) return;
    const carBox = new THREE.Box3().setFromObject(localCar.mesh);

    // Muros
    if (localCar.mesh.position.x > 38 || localCar.mesh.position.x < -38) {
        localCar.takeDamage(10);
        localCar.speed *= 0.5; // Bateu no muro, perde vel
        localCar.mesh.position.x = Math.max(-38, Math.min(38, localCar.mesh.position.x));
    }

    // Itens
    for (let i = items.length - 1; i >= 0; i--) {
        if (carBox.intersectsBox(new THREE.Box3().setFromObject(items[i].mesh))) {
            if (items[i].type === 'health') localCar.health = Math.min(100, localCar.health + 30);
            if (items[i].type === 'nitro') localCar.nitro = Math.min(150, localCar.nitro + 50);
            
            scene.remove(items[i].mesh);
            items.splice(i, 1);
        }
    }

    // Obstáculos
    for (let i = obstacles.length - 1; i >= 0; i--) {
        if (carBox.intersectsBox(new THREE.Box3().setFromObject(obstacles[i].mesh))) {
            localCar.takeDamage(obstacles[i].damage);
            localCar.speed *= 0.2; // Batida seca
            scene.remove(obstacles[i].mesh);
            obstacles.splice(i, 1);
        }
    }
}

function gameLoop() {
    // ... setup do dt ...
    
    if (localCar) {
        localCar.update(dt, keys);
        checkCollisions();

        // Rotação dos itens no chão
        items.forEach(i => { i.mesh.rotation.y += 2 * dt; });

        // IA da Polícia
        if (policeActive && policeCar) {
            policeCar.lookAt(localCar.mesh.position);
            policeCar.translateZ(160 * dt); // Mais rápido que o jogador base
            
            if (policeCar.position.distanceTo(localCar.mesh.position) < 5) {
                localCar.takeDamage(30); // Takedown
                scene.remove(policeCar);
                policeActive = false;
                policeCar = null;
                showEvent("VOCÊ FOI PEGO!", 0xff0000);
            }
        }

        // Câmera Dinâmica
        let camOffset = new THREE.Vector3(0, 4, 10);
        if (localCar.isDrifting) camOffset = new THREE.Vector3(6, 4, 8); // Drift Cam
        if (localCar.emoteActive) camOffset = new THREE.Vector3(0, 6, 15); // Afasta pra ver o mortal
        
        const idealCamPos = localCar.mesh.position.clone().add(
            camOffset.applyMatrix4(new THREE.Matrix4().extractRotation(localCar.mesh.matrix))
        );
        camera.position.lerp(idealCamPos, 0.1);
        camera.lookAt(localCar.mesh.position);

        // Atualiza UI
        document.getElementById('healthBar').style.width = localCar.health + '%';
        document.getElementById('nitroVal').innerText = Math.floor(localCar.nitro);
    }

    renderer.render(scene, camera);
}