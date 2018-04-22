const Room = require('../models/room.js');

let io,
    mapData;

module.exports = function(server, data) {
    io = require('socket.io')(server);
    io.on('connection', _onConnection);

    mapData = data;
};

const rooms = {}, // list of all rooms
    allOnlinePlayers = {}; // list of all players who are currently online

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
    socket.on("REQUEST_MORTGAGE", requestMortgage);
    socket.on("REQUEST_UNMORTGAGE", requestUnmortgage);
    socket.on("DECLARE_BANKRUPTCY", declareBankruptcy);

    // on client disconnect
    function onDisconnect () {
        console.log('A user has disconnected', currentPlayerId);

        // remove current player from current room
        if (rooms[currentRoomId]) {
            rooms[currentRoomId].removePlayer(currentPlayerId);
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
        if (!rooms[currentRoomId]) {
            rooms[currentRoomId] = new Room (currentRoomId, currentPlayerId, mapData.squares);
        }

        _updateAllPlayerList(currentPlayerId, currentRoomId);

        socket.emit("GAME_CREATED", {
            msg: "New game room created with id " + currentRoomId,
            allOnlinePlayers: allOnlinePlayers,
            room: rooms[currentRoomId],
            mapData: mapData
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

            if (rooms[currentRoomId] && rooms[currentRoomId].getAllPlayers()) {

                rooms[currentRoomId].addPlayer(currentPlayerId);

                _updateAllPlayerList(currentPlayerId, currentRoomId);

                socket.emit("GAME_JOINED", {
                    msg: "Game room joined with id " + currentRoomId,
                    allOnlinePlayers: allOnlinePlayers,
                    room: rooms[currentRoomId],
                    mapData: mapData
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

    function declareBankruptcy () {
        // check if it is currentPlayerId's turn
        if (!rooms[currentRoomId].isPlayersTurn(currentPlayerId)) {
            socket.emit("INVALID_TURN");
            return;
        }

        _triggerBankruptcy();

        // trigger next player's turn
        rooms[currentRoomId].updateNextTurn();
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
        if (!rooms[currentRoomId].isPlayersTurn(currentPlayerId)) {
            socket.emit("INVALID_TURN");
            return;
        }

        // get sum of 2 dice rolls
        let spaces = _rollDice();

        // add "spaces" to player's current position; after crossing 39, player goes to 0
        currentSquareId = rooms[currentRoomId].getPlayerPosition(currentPlayerId) + spaces;
        if (currentSquareId > 39) {
            currentSquareId -= 40;
        }

        // move player to computed position
        rooms[currentRoomId].setPlayerPosition(currentPlayerId, currentSquareId);

        // inform everyone in currentRoomId that currentPlayerId has moved to currentSquareId
        io.sockets.in(currentRoomId).emit("PLAYER_MOVED", {
            player: currentPlayerId,
            position: currentSquareId,
            msg: currentPlayerId + " moves to " + currentSquareId
        });

        let shouldEndTurn = _executeSquare();

        if (shouldEndTurn) {
            // update nextTurn
            rooms[currentRoomId].updateNextTurn();
        }
    }

    function propertyPurchased (data) {
        // check if it is currentPlayerId's turn
        if (!rooms[currentRoomId].isPlayersTurn(currentPlayerId)) {
            socket.emit("INVALID_TURN");
            return;
        }

        // get details of square
        let squareDetails = rooms[currentRoomId].getSquareDetails(currentSquareId);

        // if player opted to buy property
        if (data.response) {
            // assign property to player
            squareDetails.owner = currentPlayerId;

            // deduct funds from player
            rooms[currentRoomId].addPlayerCash(currentPlayerId, -squareDetails.price);

            // inform everyone in currentRoomId that currentPlayerId has bought the property
            io.sockets.in(currentRoomId).emit("PROPERTY_PURCHASED", {
                buyer: currentPlayerId,
                squareId: currentSquareId,
                msg: currentPlayerId + " bought " + squareDetails.propertyName + " for " + squareDetails.price
            });
        }

        // update nextTurn
        rooms[currentRoomId].updateNextTurn();
    }

    function tradeProposalInitiated (data) {
        // ignore if a trade is currently in progress
        if (rooms[currentRoomId].getCurrentTrade()) {
            return;
        }

        const offered = data.offered, // offered by currentPlayerId to data.tradeWithPlayerId
            requested = data.requested, // currentPlayerId will requested from data.tradeWithPlayerId
            proposedTo = data.tradeWithPlayerId;

        // ignore if trade proposal is invalid
        const isTradeOfferValid = rooms[currentRoomId].isTradeOfferValid (currentPlayerId, proposedTo, offered, requested);
        if (!isTradeOfferValid) {
            return;
        }

        const currentTrade = {
            proposedBy: currentPlayerId,
            proposedTo,
            offered,
            requested,
            msg: currentPlayerId + " has proposed a trade with " + proposedTo
        };

        // save details of current trade proposal
        rooms[currentRoomId].setCurrentTrade(currentTrade);

        // inform other players in currentRoomId that currentPlayerId has proposed a trade with tradeWithPlayerId
        socket.broadcast.to(currentRoomId).emit("TRADE_PROPOSAL_RECEIVED", currentTrade);
    }

    function tradeProposalResponded (data) {
        const tradeData = rooms[currentRoomId].getCurrentTrade();
        // ignore if no trade is found or invalid player responds to trade proposal
        if (!tradeData || tradeData.proposedTo !== currentPlayerId) {
            console.warn("invalid player cannot respond to trade offer");
            return;
        }

        // make trade exchange happen; assign cash and properties
        if (data.response) {
            rooms[currentRoomId].executeTrade();

            // deliver TRADE_SUCCESSFUL message to all players in room
            io.sockets.in(currentRoomId).emit("TRADE_SUCCESSFUL", {
                tradeData: tradeData,
                msg: tradeData.proposedTo + " accepted an offer from " + tradeData.proposedBy
            });
        }

        // conclude current trade (set it to null)
        rooms[currentRoomId].setCurrentTrade(null);
    }

    function requestMortgage (data) {
        const { squaresMortgaged, cashFromMortgage} = rooms[currentRoomId].mortgageProperties(currentPlayerId, data.squares);

        // trigger message via socket if at least one valid property is mortgaged
        if (squaresMortgaged.length) {
            // inform everyone in currentRoomId that currentPlayerId has mortgaged property
            io.sockets.in(currentRoomId).emit("PROPERTY_MORTGAGED", {
                playerId: currentPlayerId,
                squares: squaresMortgaged,
                cash: cashFromMortgage,
                msg: currentPlayerId + " mortgaged " + squaresMortgaged + " for " + cashFromMortgage
            });
        }
    }

    function requestUnmortgage (data) {
        const { squaresUnmortgaged, costForUnmortgage} = rooms[currentRoomId].unmortgageProperties(currentPlayerId, data.squares);

        // trigger message via socket if at least one valid property is unmortgaged
        if (squaresUnmortgaged.length) {
            // inform everyone in currentRoomId that currentPlayerId has unmortgaged property
            io.sockets.in(currentRoomId).emit("PROPERTY_UNMORTGAGED", {
                playerId: currentPlayerId,
                squares: squaresUnmortgaged,
                cash: costForUnmortgage,
                msg: currentPlayerId + " paid off his mortgage on " + squaresUnmortgaged + " with " + costForUnmortgage
            });
        }
    }


    /* Private methods */

    // add current player to Socket IO room; broadcast it to all players in room
    function _joinSession () {
        // join currentRoomId room
        socket.join(currentRoomId);

        // inform everyone in currentRoomId of new joinee
        io.sockets.in(currentRoomId).emit("JOINED_SESSION", {
            playerId: currentPlayerId,
            players: rooms[currentRoomId].getAllPlayers(),
            room: rooms[currentRoomId],
            msg: currentPlayerId + " joining " + currentRoomId
        });
    }

    function _triggerBankruptcy (playerId) {
        playerId = playerId || currentPlayerId;
        rooms[currentRoomId].setPlayerActiveStatus(playerId, false);

        // inform everyone in currentRoomId that playerId is bankrupt
        io.sockets.in(currentRoomId).emit("PLAYER_BANKRUPT", {
            playerId: playerId,
            msg: playerId + " is bankrupt"
        });
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

    // execute whatever is on square
    function _executeSquare () {
        // get details of square
        let squareDetails = rooms[currentRoomId].getSquareDetails(currentSquareId);

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
                    rooms[currentRoomId].addPlayerCash(currentPlayerId, -rent);
                    // add funds to square owner
                    rooms[currentRoomId].addPlayerCash(squareDetails.owner, rent);
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
}

// create new entry in rooms for new roomId if it doesn't already exist; store currentPlayerId against it
function _updateAllPlayerList (playerId, roomId) {
    // create new entry in players for playerId if it doesn't already exist; store roomId against it
    allOnlinePlayers[playerId] = allOnlinePlayers[playerId] || {};
    allOnlinePlayers[playerId].rooms = allOnlinePlayers[playerId].rooms || [];
    allOnlinePlayers[playerId].rooms.push(roomId);
}
