// let socket = io();
// socket connection that works locally and on the server:
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/ting/port-4280/socket.io" }); // e.g. '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}
let formeElm = document.querySelector("#chatForm");
console.log(formeElm);
let msgInput = document.querySelector("#newMessage");
console.log(msgInput);
let nameInput = document.querySelector("#nameWrapper input");
let breedInput = document.querySelector("#breed");

// LISTEN FOR NEWLY TYPES MESSAGES,
formeElm.addEventListener("submit", newMessageSubmitted);

function newMessageSubmitted(event) {
  console.log("Typed a message!", event);
  // prevent form from refreshing page
  event.preventDefault();

  let newMsg = msgInput.value;
  console.log(newMsg);
  //appendMessage(newMsg);

  let messageData = {
    sender: nameInput.value,
    breed: breedInput.value,
    message: newMsg,
  };

  // SEND THEM TO THE SERVER
  socket.emit("MessageFromClient", messageData);

  // clear input box
  msgInput.value = "";
}

// LISTEN FOR NEW MESSAGES FROM SERVER
// APPEND THEM TO THE MESSAGE BOX
// AUTO SCROLL TO BOTTOM
socket.on("MessageFromServer", function (msgData) {
  console.log("got a message", msgData);
  appendMessage(msgData);
});

// APPEND MESSAGES TO BOX
function appendMessage(data) {
  console.log(data);
  // select list (ul) first
  let chatThreadList = document.querySelector("#threadWrapper ul");
  console.log(chatThreadList);

  // create new list item (li)
  let newListItem = document.createElement("li");
  // newListItem.innerText = txt;

  // add class based on sender
  if (data.sender === nameInput.value) {
    newListItem.className = "me";
  } else {
    newListItem.className = "other";
  }

  //sender
  let who = document.createElement("span");
  who.className = "who";
  who.innerText = data.sender;

  //message
  let words = document.createElement("span");
  words.className = "words";

  if (data.sender === nameInput.value) {
    words.innerText = data.message;
  } else {
    let hearts = "";
    for (let char of data.message) {
      if (char === " ") {
        hearts += " ";
      } else {
        hearts += "♥";
      }
    }
    words.innerText = hearts;
  }

  //avatar
  let avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = `assets/${data.breed}.svg`;

  // bubble for name + message
  let profile = document.createElement("div");
  profile.className = "profile";
  profile.append(avatar);
  profile.append(who);

  // order based on sender
  if (newListItem.className === "me") {
    newListItem.append(words);
    newListItem.append(profile);
  }

  if (newListItem.className === "other") {
    newListItem.append(profile);
    newListItem.append(words);
  }

  // append new li to the list
  chatThreadList.append(newListItem);

  // scroll to bottom of textbox:
  chatThreadList.scrollTop = chatThreadList.scrollHeight;
}

// OPTIONAL: LISTEN FOR NEW NAME
// SEND IT TO SERVER

// Switch Pages
function goTo(id) {
  document.querySelectorAll(".page").forEach((p) => {
    p.classList.remove("active");
  });
  const target = document.getElementById(id);
  if (target) {
    target.classList.add("active");
  } else {
    console.error(`Element with id "${id}" not found.`);
  }
}
