function getOrCreateUserId() {
  let userID = localStorage.getItem("user-id");
  console.log(userID);
  // check if we have a userID already in local storage
  // if yes, return it
  // if not, create one and return it
  if (userID == undefined) {
    // userID = make a new one
    userID = crypto.randomUUID();
    //store on local storage
    localStorage.setItem("user-id", userID);
  }
  return userID;
}

let nameInput = document.querySelector("#nameInput");

const myUserId = getOrCreateUserId();
console.log("My userId:", myUserId);

function getOrCreateUsername() {
  let username = localStorage.getItem("user-name");
  if (username == undefined) {
    username = "";
    localStorage.setItem("user-name", username);
  } else {
    nameInput.value = username;
  }
  return username;
}

//check if we have a username already
let myUsername = getOrCreateUsername();

// start socket
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/ting/port-4280/socket.io" }); // yields '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}

let myInfo = {
  userId: myUserId,
  username: myUsername,
};
// "login" to server, sending out "identify"
// emit some message to server.
console.log(myInfo);
socket.emit("identify", myInfo);

//handle username change
nameInput.addEventListener("change", function () {
  console.log("changed name", nameInput.value);
  let name = nameInput.value;
  console.log("new name", name);
  // save to local storage
  localStorage.setItem("user-name", nameInput.value);
  // locally

  // tell server about it
});

let formeElm = document.querySelector("#chatForm");
console.log(formeElm);
let msgInput = document.querySelector("#newMessage");
console.log(msgInput);

// LISTEN FOR NEWLY TYPED MESSAGES,
// SEND THEM TO THE SERVER
formeElm.addEventListener("submit", newMessagesSubmitted);

function newMessagesSubmitted(event) {
  console.log(event);
  //stop form element from refreshing the page
  event.preventDefault();

  let newMsg = msgInput.value;
  console.log(newMsg);

  // appendMessage(newMsg); // just for fun,
  // actuaally we need to
  // send the new message to
  // the server first:
  socket.emit("message-from-client", {
    message: newMsg,
  });

  // clear out input:
  msgInput.value = "";
}

socket.on("message-from-server", function (data) {
  // waht do to with the messaeg from server
  console.log("got message", data);
  appendMessage(data);
});

socket.on("chat-history", function (data) {
  // deal with chat history
});

// APPEND MESSAGES TO BOX
function appendMessage(data) {
  // console.log(data)
  // select list (ul) first
  let chatThreadList = document.querySelector("#threadWrapper ul");
  // console.log(chatThreadList)

  // create new list item (li)
  let newListItem = document.createElement("li");
  // class name if message is out own message

  //sender
  let who = document.createElement("span");
  who.className = "who";
  // who.innerText =

  newListItem.append(who);

  //messsage
  let words = document.createElement("span");
  words.className = "words";
  words.innerText = data.text;

  newListItem.append(words);

  // append new li to the list
  chatThreadList.append(newListItem);

  // scroll to bottom of textbox:
  chatThreadList.scrollTop = chatThreadList.scrollHeight;
}
