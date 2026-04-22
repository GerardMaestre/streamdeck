const os = require("os");
const Logger = require("./logger");

let lastCPU = process.cpuUsage();

function startPerformanceMonitor(io) {
    setInterval(() => {
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage(lastCPU);
        lastCPU = process.cpuUsage();

        const data = {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            cpuUser: cpu.user,
            cpuSystem: cpu.system
        };

        Logger.system("PERF " + JSON.stringify(data));

        if (mem.heapUsed > 500 * 1024 * 1024) {
            Logger.warn("HIGH MEMORY USAGE", data);
        }

        io.emit("performance:update", data);

    }, 3000);
}

module.exports = startPerformanceMonitor;
