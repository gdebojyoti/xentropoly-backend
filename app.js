(function() {

"use strict";

const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 31291;
const INDEX = path.join(__dirname, 'index.html');

const server = express()
	.use((req, res) => res.sendFile(INDEX) )
	.listen(PORT, () => console.log(`Listening on ${ PORT }`));

const jsonData = require("./data/international.json");

require('./services/socketService.js')(server, jsonData);

})();
