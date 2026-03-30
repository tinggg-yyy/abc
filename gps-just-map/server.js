const express = require('express');

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");
const app = express(); // the server "app", the server behaviour
const portHTTPS = 3010; // YOUR port

// returning to the client anything that is
// inside the public folder
app.use(express.static('public'));


// Creating object of key and certificate
// for SSL
const options = {
    key: fs.readFileSync("localhost-key.pem"),
    cert: fs.readFileSync("localhost.pem"),
};

let HTTPSserver = https.createServer(options, app)


const { Server } = require('socket.io'); // include library
const io = new Server(HTTPSserver); // start socket io 

let currentlyConntected = []; //list of socket IDs of copnnected clients

io.on('connection', (socket) => {

    // we manage the connection inside here
    console.log('a user connected', socket.id);
    // keep track of all clients connected
    currentlyConntected.push(socket.id);
    console.log(currentlyConntected);

    

    // DISCONNECT
    socket.on("disconnect", function(){
        console.log("someone disconnected", socket.id)

        // delete socket ID from the global array
        // that keeps track of all connected clients 
        let idx = currentlyConntected.indexOf(socket.id);
        if(idx > -1){
            currentlyConntected.splice(idx, 1);
            console.log(currentlyConntected);
        }
    })

})



// additional express server endpoints could be made here:



// Creating https server by passing
// options and app object
HTTPSserver.listen(portHTTPS, function (req, res) {
    console.log("HTTPS Server started at port", portHTTPS);
});





