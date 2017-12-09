var io;
var rooms = {}, // list of all rooms
    allOnlinePlayers = {}; // list of all players who are currently online

module.exports = function(server) {
    io = require('socket.io')(server);
    io.on('connection', _onConnection);
};

function _onConnection (socket) {
    setInterval(() => io.emit('time', new Date().toTimeString()), 1000);

    let currentRoomId,
        currentPlayerId;

    console.log("A user has connected");
    socket.on("disconnect", () => console.log('Client disconnected'));

    socket.on("HOST_GAME", hostGame);
    socket.on("JOIN_GAME", joinGame);

    function hostGame (data) {
        currentPlayerId = data.playerId;

        // generate new currentRoomId
        currentRoomId = "r" + Date.now() % 1000000000;

        // create new entry in rooms for new currentRoomId if it doesn't already exist; store currentPlayerId against it
        rooms[currentRoomId] = rooms[currentRoomId] || {};
        rooms[currentRoomId].players = rooms[currentRoomId].players || [];
        rooms[currentRoomId].players.push(currentPlayerId);

        _updateAllPlayerList(currentPlayerId, currentRoomId);

        socket.emit("GAME_CREATED", {
            msg: "New game room created with id " + currentRoomId,
            allPlayers: allOnlinePlayers,
            rooms: rooms
        });
    }

    function joinGame (data) {
        let hostPlayerId = data.hostPlayerId;

        currentPlayerId = data.playerId;

        if (hostPlayerId && allOnlinePlayers[hostPlayerId] && allOnlinePlayers[hostPlayerId].rooms) {

            // get current room of hostPlayerId
            currentRoomId = allOnlinePlayers[hostPlayerId].rooms[0];

            if (rooms[currentRoomId] && rooms[currentRoomId].players) {

                rooms[currentRoomId].players.push(currentPlayerId);

                _updateAllPlayerList(currentPlayerId, currentRoomId);

                socket.emit("GAME_JOINED", {
                    msg: "Game room joined with id " + currentRoomId,
                    allPlayers: allOnlinePlayers,
                    rooms: rooms
                });

            } else {
                socket.emit("SESSION_NOT_FOUND", {
                    msg: "No non-empty session exists with id " + currentRoomId
                });
            }

        } else {
            socket.emit("HOST_NOT_FOUND", {
                msg: "Could not find host player with id " + hostPlayerId
            });
        }
    }
}

// create new entry in rooms for new roomId if it doesn't already exist; store currentPlayerId against it
function _updateAllPlayerList (playerId, roomId) {
    // create new entry in players for playerId if it doesn't already exist; store roomId against it
    allOnlinePlayers[playerId] = allOnlinePlayers[playerId] || {};
    allOnlinePlayers[playerId].rooms = allOnlinePlayers[playerId].rooms || [];
    allOnlinePlayers[playerId].rooms.push(roomId);
}
