const express = require("express");

const https = require("https");
// to read certificates from the filesystem (fs)
const fs = require("fs");

const app = express(); // the server "app", the server behaviour!
const portHTTPS = 3014; // port for https

// Creating object of key and certificate
// for SSL
const options = {
  key: fs.readFileSync("keys-for-local-https/localhost-key.pem"),
  cert: fs.readFileSync("keys-for-local-https/localhost.pem"),
};

let HTTPSserver = https.createServer(options, app);

const { Server } = require("socket.io"); // include library
const io = new Server(HTTPSserver); // start socket io

let photos = [];
let dataText = fs.readFileSync("photos.json", "utf8");
photos = JSON.parse(dataText);

// HTTPS ROUTES:

// returning to the client anything that is
// inside the public folder
app.use(express.static("public"));

// app.get("/", (req, res) =>{
//     res.sendFile(__dirname + '/public/index.html')
// });

// app.get("/style.css", (req, res) => {
//   res.sendFile(__dirname + "/public/style.css");
// });

app.post("/upload-photo", (req, res) => {
  console.log("someone upload photo");

  // save photo to server
  const filename = crypto.randomUUID() + ".png"; // filename with timestamp
  const filepath = "public/uploads/" + filename;
  const writeStream = fs.createWriteStream(filepath);
  req.pipe(writeStream);

  req.on("end", () => {
    // res.json({ url: 'uploads/' + filename });
    res.sendStatus(200);

    let imageURL = "uploads/" + filename;
    console.log("imageURL", imageURL);

    // save image path to photos array
    let imageData = {
      url: imageURL,
    };
    photos.push(imageData);
    console.log(photos);
    // save photos array to JSON file
    let urlText = JSON.stringify(photos, null, 2);
    fs.writeFileSync("photos.json", urlText, "utf8");
    // let online users know about the new path
    io.emit("new-photo", imageURL);
  });
});

// SOCKET HANDLING:

io.on("connection", (socket) => {
  // we manage the connection inside here
  console.log("a user connected", socket.id);

  // send historic photos to new connection
  socket.emit("historic-photos", photos);

  socket.on("disconnect", function () {
    console.log("someone disconnected", socket.id);
  });
});

// Creating servers and make them listen at their ports:

HTTPSserver.listen(portHTTPS, function (req, res) {
  console.log("HTTPS Server started at port", portHTTPS);
});
