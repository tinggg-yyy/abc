// let socket = io();
// socket connection that works locally and on the server:
if (
  location.hostname.toLowerCase().startsWith("browsercircus") ||
  location.hostname.toLowerCase().startsWith("www")
) {
  socket = io({ path: "/ting/port-4281/socket.io" }); // e.g. '/leon/port-4100/socket.io' or '/socket.io'
} else {
  socket = io();
}
