// Stand-in for the WhatsApp Cloud API. GET /sent lists what the app tried to send.
import http from "node:http";

const sent = [];
http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (req.url === "/sent") return res.end(JSON.stringify(sent));
    sent.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }));
  });
}).listen(4600, () => console.log("whatsapp mock ready"));
