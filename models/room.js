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

    addPlayer (playerId) {
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

    removePlayer (playerId) {
        delete this.players[playerId];
    }

    // get amount of funds player currently has
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

    setSquares (squares) {
        this.squares = JSON.parse(JSON.stringify(squares));
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

    mortgageProperties (playerId, squares) {
        // keep track of squares that are actually being mortgaged
        let squaresMortgaged = [];
        // keep track of cash that will be earned by mortgaging
        let cashFromMortgage = 0;

        for (let squareId of squares) {
            // get details of square
            const squareDetails = this.getSquareDetails(squareId);

            // ignore & continue if squareId does not belong to playerId
            if (squareDetails.owner !== playerId) {
                console.log(squareId + " does not belong to " + playerId);
                continue;
            }

            // ignore & continue if squareId is already mortgaged
            if (squareDetails.isMortgaged) {
                console.log(squareId + " is already mortgaged");
                continue;
            }

            // add mortgaging funds to cashFromMortgage
            cashFromMortgage += squareDetails.mortgage;

            // set isMortgaged to true for squareId
            squareDetails.isMortgaged = true;

            // add square ID to array on successful mortgage
            squaresMortgaged.push(squareId);
        }

        // add funds if at least one valid property is mortgaged
        if (squaresMortgaged.length) {
            this.addPlayerCash(playerId, cashFromMortgage);
        }

        return {
            squaresMortgaged,
            cashFromMortgage
        };
    }

    unmortgageProperties (playerId, squares) {
        // keep track of squares that are actually being unmortgaged
        let squaresUnmortgaged = [];
        // keep track of cash that will be deducted for paying off mortgages
        let costForUnmortgage = 0;

        for (let squareId of squares) {

            // get details of square
            const squareDetails = this.getSquareDetails(squareId);

            // ignore & continue if squareId does not belong to playerId
            if (squareDetails.owner !== playerId) {
                console.log(squareId + " does not belong to " + playerId);
                continue;
            }

            // ignore & continue if squareId is not mortgaged
            if (!squareDetails.isMortgaged) {
                console.log(squareId + " is not mortgaged");
                continue;
            }

            // add unmortgaging funds to costForUnmortgage
            costForUnmortgage += squareDetails.unmortgage;

            // set isMortgaged to false for squareId
            squareDetails.isMortgaged = false;

            // add square ID to array on successful pay off
            squaresUnmortgaged.push(squareId);

        }

        // ignore if player has less funds than mortgage payoff cost
        if (this.getPlayerCash(playerId) < costForUnmortgage) {
            console.log("Player cannot afford to unmortgage selected properties");
            return {
                squaresUnmortgaged: [],
                costForUnmortgage: 0
            };
        }

        // remove funds if at least one valid property is unmortgaged
        if (squaresUnmortgaged.length) {
            this.addPlayerCash(playerId, -costForUnmortgage);
        }

        return {
            squaresUnmortgaged,
            costForUnmortgage
        };
    }

    // trade

    getCurrentTrade () {
        return this.currentTrade;
    }

    setCurrentTrade (currentTrade) {
        this.currentTrade = currentTrade;
    }

    // check if trade proposal if valid
    isTradeOfferValid (playerId, tradeWithPlayerId, offered, requested) {
        // offered or requested cash cannot be negative
        if (offered.cash < 0 || requested.cash < 0) {
            console.log("Cash cannot be negative");
            return false;
        }

        // all offered squares must belong to playerId
        if (offered.squares && offered.squares.length > 0) {
            for (let square of offered.squares) {
                if (this.getSquareOwner(square) !== playerId) {
                    console.log(square + " does not belong to " + playerId);
                    return false;
                }
            }
        }

        // all requested squares must belong to tradeWithPlayerId
        if (requested.squares && requested.squares.length > 0) {
            for (let square of requested.squares) {
                if (this.getSquareOwner(square) !== tradeWithPlayerId) {
                    console.log(square + " does not belong to " + tradeWithPlayerId);
                    return false;
                }
            }
        }

        return true;
    }

    executeTrade () {
        const tradeData = this.getCurrentTrade();
        const { offered, requested, proposedTo, proposedBy } = tradeData;

        // alter funds
        if (offered.cash > 0) {
            // add funds to proposedTo player
            this.addPlayerCash(proposedTo, offered.cash);
            // remove funds from proposedBy player
            this.addPlayerCash(proposedBy, -offered.cash);
        }
        if (requested.cash > 0) {
            // add funds to proposedBy player
            this.addPlayerCash(proposedBy, offered.cash);
            // remove funds from proposedTo player
            this.addPlayerCash(proposedTo, -offered.cash);
        }

        // assign properties
        if (offered.squares && offered.squares.length > 0) {
            // set owner of all offered properties to proposedTo player
            for (const square of offered.squares) {
                this.setSquareOwner(square, proposedTo);
            }
        }
        if (requested.squares && requested.squares.length > 0) {
            // set owner of all received properties to proposedBy player
            for (const square of requested.squares) {
                this.setSquareOwner(square, proposedBy);
            }
        }
    }

    // next turn

    getNextTurn () {
        return this.nextTurn;
    }

    isPlayersTurn (playerId) {
        return this.getNextTurn() === playerId;
    }

    setNextTurn (playerId) {
        this.nextTurn = playerId;
    }

    updateNextTurn () {
        let playersArr = Object.keys(this.getAllPlayers()),
            oldNextTurn = this.nextTurn,
            index = playersArr.indexOf(oldNextTurn);

        let cyclesCompleted = 0; // prevent infinite loop when all players have been declared bankrupt

        // select the next player who is active (i.e., ignore bankrupt players)
        do {
            index = index + 1 < playersArr.length ? index + 1 : 0;
            this.nextTurn = playersArr[index];
            if (index === 0) {
                cyclesCompleted++;
            }
        } while (!this.getPlayerActiveStatus(playersArr[index]) && cyclesCompleted < 2)

        console.log("Next turn:", this.nextTurn);
    }
}

// generate player & add it to players object; update next turn; set squares
function _initializeRoom (playerId, squares) {
    this.addPlayer(playerId);
    this.setNextTurn(playerId);
    this.setSquares(squares);
}

module.exports = Room;