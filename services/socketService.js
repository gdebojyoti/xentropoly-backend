var io,
    mapData;

module.exports = function(server, data) {
    io = require('socket.io')(server);
    io.on('connection', _onConnection);

    mapData = data;
};

var rooms = {}, // list of all rooms
    allOnlinePlayers = {}, // list of all players who are currently online
    sampleRoom = {
        // isPlaying: false,
        players: {},
        nextTurn: null,
        // diceRolled: false,
        squares: null,
        currentTrade: null
    },
    samplePlayerDetails = {
        position: 0,
        cash: 1500
    };

function _onConnection (socket) {
    setInterval(() => io.emit('time', new Date().toTimeString()), 1000);

    let currentRoomId,
        currentPlayerId,
        currentSquareId;

    console.log("A user has connected");
    socket.on("disconnect", onDisconnect);

    socket.on("HOST_GAME", hostGame);
    socket.on("JOIN_GAME", joinGame);
    socket.on("CHAT_MESSAGE_SENT", chatMessageSent);
    socket.on("TRIGGER_TURN", triggerTurn);
    socket.on("PROPERTY_PURCHASED", propertyPurchased);
    socket.on("TRADE_PROPOSAL_INITIATED", tradeProposalInitiated);
    socket.on("TRADE_PROPOSAL_RESPONDED", tradeProposalResponded);

    // on client disconnect
    function onDisconnect () {
        console.log('Client disconnected', currentPlayerId);

        // remove current player from current room
        if (rooms[currentRoomId] && rooms[currentRoomId].players[currentPlayerId]) {
            delete rooms[currentRoomId].players[currentPlayerId];
        }

        // remove corresponding entry from allOnlinePlayers
        if (allOnlinePlayers[currentPlayerId] && allOnlinePlayers[currentPlayerId].rooms) {
            // remove currentRoomId entry from current player in allOnlinePlayers list
            allOnlinePlayers[currentPlayerId].rooms.splice(allOnlinePlayers[currentPlayerId].rooms.indexOf(currentRoomId), 1);

            // remove current player from online list if no more active rooms found
            if (allOnlinePlayers[currentPlayerId].rooms.length === 0) {
                delete allOnlinePlayers[currentPlayerId];
            }
        }
    }

    // create a new room and join it
    function hostGame (data) {
        currentPlayerId = data.playerId;

        // generate new unique currentRoomId
        do {
            currentRoomId = "r" + Date.now() % 10000000;
        } while (rooms[currentRoomId]);

        // create new entry in rooms for new currentRoomId if it doesn't already exist; store currentPlayerId against it
        rooms[currentRoomId] = JSON.parse(JSON.stringify(sampleRoom));
        rooms[currentRoomId].players[currentPlayerId] = JSON.parse(JSON.stringify(samplePlayerDetails));
        rooms[currentRoomId].nextTurn = currentPlayerId;
        rooms[currentRoomId].squares = JSON.parse(JSON.stringify(mapData.squares));

        _updateAllPlayerList(currentPlayerId, currentRoomId);

        socket.emit("GAME_CREATED", {
            msg: "New game room created with id " + currentRoomId,
            allPlayers: allOnlinePlayers,
            rooms: rooms
        });

        _joinSession();
    }

    // join room of existing player
    function joinGame (data) {
        let hostPlayerId = data.hostPlayerId;

        currentPlayerId = data.playerId;

        if (hostPlayerId && allOnlinePlayers[hostPlayerId] && allOnlinePlayers[hostPlayerId].rooms) {

            // get hostPlayerId's current room id
            currentRoomId = allOnlinePlayers[hostPlayerId].rooms[0];

            if (rooms[currentRoomId] && rooms[currentRoomId].players) {

                rooms[currentRoomId].players[currentPlayerId] = JSON.parse(JSON.stringify(samplePlayerDetails));

                _updateAllPlayerList(currentPlayerId, currentRoomId);

                socket.emit("GAME_JOINED", {
                    msg: "Game room joined with id " + currentRoomId,
                    allPlayers: allOnlinePlayers,
                    rooms: rooms
                });

                _joinSession();

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

    // chat message sent by currentPlayerId
    function chatMessageSent (data) {
        if (data.msg) {
            socket.broadcast.to(currentRoomId).emit("CHAT_MESSAGE_RECEIVED", {
                sender: currentPlayerId,
                msg: data.msg
            });
        }
    }

    // roll dice; move player; execute card details
    function triggerTurn () {
        // check if it is currentPlayerId's turn
        if (!_isCurrentPlayersTurn()) {
            socket.emit("INVALID_TURN");
            return;
        }

        // get sum of 2 dice rolls
        let spaces = _rollDice();

        // add "spaces" to player's current position; after crossing 39, player goes to 0
        currentSquareId = rooms[currentRoomId].players[currentPlayerId].position + spaces;
        if (currentSquareId > 39) {
            currentSquareId -= 40;
        }

        // move player to computed position
        rooms[currentRoomId].players[currentPlayerId].position = currentSquareId;

        // inform everyone in currentRoomId that currentPlayerId has moved to currentSquareId
        io.sockets.in(currentRoomId).emit("PLAYER_MOVED", {
            player: currentPlayerId,
            position: currentSquareId,
            msg: currentPlayerId + " moves to " + currentSquareId
        });

        let shouldEndTurn = _executeSquare();

        if (shouldEndTurn) {
            // update nextTurn
            _updateNextTurn();
        }
    }

    function propertyPurchased (data) {
        // check if it is currentPlayerId's turn
        if (!_isCurrentPlayersTurn()) {
            socket.emit("INVALID_TURN");
            return;
        }

        // get details of square
        let squareDetails = rooms[currentRoomId].squares[currentSquareId];

        // if player opted to buy property
        if (data.response) {
            // assign property to player
            squareDetails.owner = currentPlayerId;

            // deduct funds from player
            _removeFunds(squareDetails.price);

            // inform everyone in currentRoomId that currentPlayerId has bought the property
            io.sockets.in(currentRoomId).emit("PROPERTY_PURCHASED", {
                buyer: currentPlayerId,
                squareId: currentSquareId,
                msg: currentPlayerId + " bought " + squareDetails.propertyName + " for " + squareDetails.price
            });
        }

        // update nextTurn
        _updateNextTurn();
    }

    function tradeProposalInitiated (data) {
        // ignore if a trade is currently in progress
        if (rooms[currentRoomId].currentTrade) {
            return;
        }

        // ignore if trade proposal is invalid
        if (!_isValidTradeOffer(data)) {
            return;
        }

        let currentTrade = {
            proposedBy: currentPlayerId,
            proposedTo: data.tradeWithPlayerId,
            offer: data.offer,
            receive: data.receive,
            msg: currentPlayerId + " has proposed a trade with " + data.tradeWithPlayerId
        };

        // save details of current trade proposal
        rooms[currentRoomId].currentTrade = currentTrade;

        // inform other players in currentRoomId that currentPlayerId has proposed a trade with tradeWithPlayerId
        socket.broadcast.to(currentRoomId).emit("TRADE_PROPOSAL_RECEIVED", currentTrade);
    }

    function tradeProposalResponded (data) {
        // ignore if no trade is found or invalid player responds to trade proposal
        if (!rooms[currentRoomId].currentTrade || rooms[currentRoomId].currentTrade.proposedTo !== currentPlayerId) {
            console.warn("invalid player cannot respond to trade offer");
            return;
        }

        // make trade exchange happen; assign cash and properties
        if (data.response) {
            let tradeData = rooms[currentRoomId].currentTrade;
            let offer = tradeData.offer;
            let receive = tradeData.receive;

            // alter funds
            if (offer.cash > 0) {
                // add funds to tradeData.proposedTo
                _addFunds(offer.cash, tradeData.proposedTo);
                // remove funds from tradeData.proposedBy
                _removeFunds(offer.cash, tradeData.proposedBy);
            }
            if (receive.cash > 0) {
                // add funds to tradeData.proposedBy
                _addFunds(offer.cash, tradeData.proposedBy);
                // remove funds from tradeData.proposedTo
                _removeFunds(offer.cash, tradeData.proposedTo);
            }

            // assign properties
            if (offer.squares && offer.squares.length > 0) {
                // set owner of all offered properties to tradeData.proposedTo
                for (let i = 0; i < offer.squares.length; i++) {
                    rooms[currentRoomId].squares[offer.squares[i]].owner = tradeData.proposedTo;
                }
            }
            if (receive.squares && receive.squares.length > 0) {
                // set owner of all received properties to tradeData.proposedBy
                for (let i = 0; i < receive.squares.length; i++) {
                    rooms[currentRoomId].squares[receive.squares[i]].owner = tradeData.proposedBy;
                }
            }

            console.log(rooms[currentRoomId].squares);
        }

        // conclude current trade (set it to null)
        rooms[currentRoomId].currentTrade = null;

        // TODO: Complete trade system
        // broadcast message to all about status of trade
        // update all player UIs if trade was successful (client side)
    }


    /* Private methods */

    // add current player to Socket IO room; broadcast it to all players in room
    function _joinSession () {
        // join currentRoomId room
        socket.join(currentRoomId);

        // inform everyone in currentRoomId of new joinee
        io.sockets.in(currentRoomId).emit("JOINED_SESSION", {
            playerId: currentPlayerId,
            players: rooms[currentRoomId].players,
            msg: currentPlayerId + " joining " + currentRoomId
        });
    }

    // check if this is current player's turn
    function _isCurrentPlayersTurn () {
        return rooms[currentRoomId].nextTurn === currentPlayerId;
    }

    // roll dice: get random integer between 2 & 12
    function _rollDice () {
        let dice1 = _getRandomInt(1, 6),
            dice2 = _getRandomInt(1, 6);

        return dice1 + dice2;
    }

    // generate random integer between "min" & "max" limits (inclusive)
    function _getRandomInt (min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // update next turn
    function _updateNextTurn () {
        let playersArr = Object.keys(rooms[currentRoomId].players),
            oldNextTurn = rooms[currentRoomId].nextTurn,
            index = playersArr.indexOf(oldNextTurn);

        rooms[currentRoomId].nextTurn = playersArr[index + 1 < playersArr.length ? index + 1 : 0];
        console.log("Next turn:", rooms[currentRoomId].nextTurn);
    }

    // execute whatever is on square
    function _executeSquare () {
        // get details of square
        let squareDetails = rooms[currentRoomId].squares[currentSquareId];

        switch (squareDetails.type) {
            // for property square: if unowned, opt to buy; if owned by others, pay rent
            case "PROPERTY":
                if (!squareDetails.owner) {
                    // offer player to buy property
                    socket.emit("OFFER_BUY_PROPERTY", {
                        squareId: currentSquareId
                    });

                    return false;
                } else if (squareDetails.owner !== currentPlayerId) {
                    let rent = squareDetails.rent;
                    // remove funds from current player
                    _removeFunds(rent);
                    // add funds to square owner
                    _addFunds(rent, squareDetails.owner);
                    io.sockets.in(currentRoomId).emit("RENT_PAID", {
                        owner: squareDetails.owner,
                        payee: currentPlayerId,
                        rent: rent,
                        msg: currentPlayerId + " paid " + rent + " rent to " + squareDetails.owner
                    });

                    return true;
                }
                break;
            default:
                console.log(squareDetails);
                return true;
        }
    }

    // add funds to player (or current player, if none specified)
    function _addFunds (amount, playerId) {
        rooms[currentRoomId].players[playerId || currentPlayerId].cash += amount;
    }

    // deduct funds from player (or current player, if none specified)
    function _removeFunds (amount, playerId) {
        rooms[currentRoomId].players[playerId || currentPlayerId].cash -= amount;
    }

    // check if trade proposal if valid
    function _isValidTradeOffer (tradeData) {
        console.log(tradeData);

        let offer = tradeData.offer; // offered by currentPlayerId to tradeData.tradeWithPlayerId
        let receive = tradeData.receive; // currentPlayerId will receive from tradeData.tradeWithPlayerId

        // offer or receive cash cannot be negative
        if (offer.cash < 0 || receive.cash < 0) {
            console.log("Cash cannot be negative!");
            return false;
        }

        // all offered squares must belong to currentPlayerId
        if (offer.squares && offer.squares.length > 0) {
            for (let i = 0; i < offer.squares.length; i++) {
                if (rooms[currentRoomId].squares[offer.squares[i]].owner !== currentPlayerId) {
                    console.log(offer.squares[i] + " does not belong to " + currentPlayerId);
                    return false;
                }
            }
        }

        // all receive squares must belong to tradeData.tradeWithPlayerId
        if (receive.squares && receive.squares.length > 0) {
            for (let i = 0; i < receive.squares.length; i++) {
                if (rooms[currentRoomId].squares[receive.squares[i]].owner !== tradeData.tradeWithPlayerId) {
                    console.log(receive.squares[i] + " does not belong to " + tradeData.tradeWithPlayerId);
                    return false;
                }
            }
        }

        return true;
    }
}

// create new entry in rooms for new roomId if it doesn't already exist; store currentPlayerId against it
function _updateAllPlayerList (playerId, roomId) {
    // create new entry in players for playerId if it doesn't already exist; store roomId against it
    allOnlinePlayers[playerId] = allOnlinePlayers[playerId] || {};
    allOnlinePlayers[playerId].rooms = allOnlinePlayers[playerId].rooms || [];
    allOnlinePlayers[playerId].rooms.push(roomId);
}
