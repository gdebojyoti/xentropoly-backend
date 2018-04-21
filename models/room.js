const Player = require('./player.js');

class Room {
    constructor (roomId, playerId, squares) {
        this.id = roomId;
        this.players = {};
        this.nextTurn = null;
        this.squares = null;
        this.currentTrade = null;

        _initializeRoom.call(this, playerId, squares);
    }

    // players

    createPlayer (playerId) {
        this.players[playerId] = new Player (playerId);
    }

    getAllPlayers () {
        return this.players;
    }

    getPlayerDetails (playerId) {
        return this.players[playerId];
    }

    getPlayerPosition (playerId) {
        return this.players[playerId].getPosition();
    }

    setPlayerPosition (playerId, position) {
        this.players[playerId].setPosition(position);
    }

    deletePlayer (playerId) {
        delete this.players[playerId];
    }

    getPlayerCash (playerId) {
        return this.players[playerId].getCash();
    }

    addPlayerCash (playerId, cash) {
        return this.players[playerId].addPlayerCash(cash);
    }

    getPlayerActiveStatus (playerId) {
        return this.players[playerId].getActiveStatus();
    }

    setPlayerActiveStatus (playerId, status) {
        this.players[playerId].setActiveStatus(status);
    }

    // squares

    getAllSquares () {
        return this.squares;
    }

    getSquareDetails (squareId) {
        return this.squares[squareId];
    }

    getSquareOwner (squareId) {
        return this.squares[squareId].owner;
    }

    setSquareOwner (squareId, playerId) {
        this.squares[squareId].owner = playerId;
    }

    // current trade

    getCurrentTrade () {
        return this.currentTrade;
    }

    setCurrentTrade (currentTrade) {
        this.currentTrade = currentTrade;
    }

    // next turn

    getNextTurn () {
        return this.nextTurn;
    }

    setNextTurn (playerId) {
        this.nextTurn = playerId;
    }
}

// generate player & add it to players object; update next turn; set squares
function _initializeRoom (playerId, squares) {
    this.createPlayer(playerId);
    this.nextTurn = playerId;
    this.squares = JSON.parse(JSON.stringify(squares));
}

module.exports = Room;