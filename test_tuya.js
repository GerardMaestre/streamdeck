const { io } = require("socket.io-client");

const socket = io("http://localhost:3000", {
    transports: ["websocket"]
});

socket.on("connect", () => {
    console.log("Connected to server");
    
    // Test Tuya command
    console.log("Sending Tuya test command...");
    socket.emit("tuya_command", {
        deviceIds: ["bf02a8f057179a10753ram"], // One of the IDs from DomoticaModule.js
        code: "switch_led",
        value: true
    }, (ack) => {
        console.log("Tuya Ack:", ack);
        setTimeout(() => process.exit(0), 1000);
    });
});

socket.on("connect_error", (err) => {
    console.error("Connect error:", err.message);
});
