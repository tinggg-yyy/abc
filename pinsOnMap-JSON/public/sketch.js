let mappa = new Mappa("Leaflet"); // map library
let myMap;
let canvas;
let currentLongitude = 0; // global variables will be updated as we get GPS data
let currentLatitude = 0; // global variables will be updated as we get GPS data
let mapInit = false; // we only do map stuff once mapInit is true (see in draw)
let me; // point object showing our own location

let usernameKEY = "user-nameTEST"; // why did i write test?
let username = localStorage.getItem(usernameKEY);
document.querySelector("#nameDisplay").innerText = username + "!";

let userHUEKEY = "user-hueTEST"; // why did i write test?
let hue = localStorage.getItem(userHUEKEY);
document.body.style.backgroundColor = "hsl(" + hue + ", 50%, 60%)";

function getOrCreateUserId() {
  let userID = localStorage.getItem("user-id");
  if (userID == undefined) {
    // userID = make a new one
    userID = crypto.randomUUID();
    // store on local storage:
    localStorage.setItem("user-id", userID);
  }
  return userID;
}

const myUserId = getOrCreateUserId();
console.log("My userId:", myUserId);

// start socket
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/YOURPATH-and-PORT/socket.io" }); // yields '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

let myInfo = {
  userId: myUserId,
  username: username,
  userHue: hue,
};

// "login" to server, sending out "identify"
// emit some message to server
console.log(myInfo);
socket.emit("identify", myInfo);

// P5 touch events: https://p5js.org/reference/#Touch
let lastTouch = 0;
let doubleTouchInterval = 250;
let lastPoint = 0;
function touchStarted() {
  if (mapInit) {
    if (
      millis() - lastTouch < doubleTouchInterval &&
      millis() - lastPoint > 1000
    ) {
      let pos = myMap.pixelToLatLng(touches[0].x, touches[0].y);
      console.log("double TOUCHED", pos);

      // locations.push({
      //   lat: pos.lat,
      //   lng: pos.lng,
      //   userId: myUserId,
      //   username: username,
      //   userHue: hue
      // })

      // send to server
      let locData = {
        lat: pos.lat,
        lng: pos.lng,
      };
      socket.emit("location-from-client", locData);

      lastPoint = millis();
    }
  }
}
function touchEnded() {
  lastTouch = millis();
}

let locations = [];

// listen for ALL location array from server
// add them to locations
socket.on("historical-locations", function (historicalLocs) {
  for (locationData of historicalLocs) {
    locations.push(locationData);
  }
});

// listen for NEW single locations from server
// add them to locations
socket.on("location-from-server", function (locationData) {
  locations.push(locationData);
});

// ---------------------------------------------------------------

// options for map
// we only actually initialize the map once we get gps data (in draw)
// there are different suppliers and styles of maps available
// these are some chinese ones I found
let mappa_options = {
  lat: 0, // will change once we have data
  lng: 0, // will change once we have data
  zoom: 16, // initial zoom level
  // style: "https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
  // style: "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}",
  style:
    "https://webst01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x={x}&y={y}&z={z}",
};

function setup() {
  canvas = createCanvas(windowWidth - 80, windowHeight - 120);
  canvas.parent("p5-canvas-container");
  me = new MyPoint();
  colorMode(HSB);
}

function draw() {
  clear();

  // Initialize full screen map (from https://mappa.js.org)
  if (!mapInit && GPS_GRANTED && currentLongitude != 0) {
    console.log("starting map");
    mappa_options.lat = currentLatitude;
    mappa_options.lng = currentLongitude;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);
    myMap.onChange(updateMapContent); // important to update our drawings on the map
    mapInit = true; // this if statement sould run only once
  }

  if (mapInit) {
    noStroke();
    fill(255, 0, 0, 0.6);
    rect(0, 0, width, height);

    // only update and draw our point if we actually have data
    me.update();
    me.display();
    // console.log(me)

    for (l of locations) {
      // console.log(l);
      let posOnCanvas = myMap.latLngToPixel(l.lat, l.lng);
      let x = posOnCanvas.x;
      let y = posOnCanvas.y;
      if (x > 0 && x < width && y > 0 && y < height) {
        noStroke();
        fill(l.userHue, 40, 80);
        let diameter = 2 * metersToPixel(10, l.lat);
        circle(x, y, diameter);
        textAlign(CENTER);
        text(l.username, x, y + diameter / 2 + 12);
      }
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function handleNewPosition(pos) {
  // console.log("NEW LOC", pos);

  // console.log("accuracy:", pos.coords.accuracy, "meters");
  me.accuracy = pos.coords.accuracy;

  document.querySelector("#requestOrientationButton").style.display = "none";
  document.querySelector("#welcome").style.display = "flex";

  // fix location for chinese map tiles (function in requestGPS.js)
  let lonlat = fixForChineseMap(pos);
  currentLongitude = lonlat[0];
  currentLatitude = lonlat[1];
  // console.log(currentLatitude, currentLongitude);

  if (mapInit) {
    // if map already displayed, update the point
    updateMapContent();
  }
}

function updateMapContent() {
  let myPosOnCanvas = myMap.latLngToPixel(currentLatitude, currentLongitude);
  me.goalX = myPosOnCanvas.x;
  me.goalY = myPosOnCanvas.y;
}

function metersToPixel(meters, lat) {
  z = myMap.zoom();
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z); // meters/pixel
  return meters / mpp;
}

class MyPoint {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.goalX = 0;
    this.goalY = 0;
    this.size = 14;
    this.col = color(170, 240, 190);
    this.accuracy = 0;
  }
  update() {
    // lerp to each new location to keep things smoother
    this.x = lerp(this.x, this.goalX, 0.2);
    this.y = lerp(this.y, this.goalY, 0.2);
  }
  display() {
    push();
    translate(this.x, this.y);

    //accuracy
    noFill();
    stroke("red");
    let diameter = 2 * metersToPixel(this.accuracy, currentLatitude);
    circle(0, 0, diameter);
    line(0, 0, diameter / 2, 0);
    fill("red");
    noStroke();
    if (mapInit) {
      textSize(map(myMap.zoom(), 9, 18, 0, 12));
    }
    // console.log(12*(myMap.getZoom()/18))
    text("accuracy:" + this.accuracy, diameter / 2 + 1, 0);

    fill(this.col);
    stroke("pink");
    strokeWeight(3);
    let dia = this.size + sin(frameCount * 0.1);
    circle(0, 0, dia);

    pop();
  }
}
