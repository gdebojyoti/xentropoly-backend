class Player {
    constructor (playerId) {
        // this.name = playerName; // name to be displayed to other players
        this.position = 0;
        this.cash = 1500;
        this.isActive = true;
    }

    getPosition () {
        return this.position;
    }

    setPosition (position) {
        position = parseInt(position);
        if (!isNaN(position)) {
            this.position = position;
        }
    }

    getCash () {
        return this.cash;
    }

    addPlayerCash (cash) {
        cash = parseInt(cash);
        if (!isNaN(cash)) {
            this.cash += cash;
        }
    }

    getActiveStatus () {
        return this.isActive;
    }

    setActiveStatus (status) {
        this.isActive = status;
    }
}

module.exports = Player;