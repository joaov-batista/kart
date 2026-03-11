let peer = null;
let connections = {};
let isHost = false;

document.getElementById('btnHost').onclick = () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    peer = new Peer(code);
    peer.on('open', id => {
        isHost = true;
        document.getElementById('btnHost').style.display = 'none';
        document.getElementById('btnJoin').style.display = 'none';
        document.getElementById('roomInfo').style.display = 'block';
        document.getElementById('displayCode').innerText = id;
        document.getElementById('btnStart').style.display = 'block';
    });

    peer.on('connection', conn => {
        connections[conn.peer] = conn;
        conn.on('data', data => handleNetworkData(data));
    });
};

document.getElementById('btnStart').onclick = () => {
    // Pega o carro e placa selecionados
    const car = document.querySelector('input[name="car"]:checked').value;
    const plate = document.getElementById('playerPlate').value;
    
    // Avisa todos pra começar
    Object.values(connections).forEach(c => c.send({ type: 'start' }));
    startGame(car, plate);
};

// Quando envia posição
function NetworkSync(car) {
    if (!peer) return;
    const data = {
        type: 'pos',
        x: car.mesh.position.x, y: car.mesh.position.y, z: car.mesh.position.z,
        rotY: car.mesh.rotation.y,
        isDrifting: car.isDrifting
    };
    if (isHost) Object.values(connections).forEach(c => c.send(data));
    // Se for cliente, envia pro host e o host repassa...
}