const Logger = require("./logger");

let lastCPU = process.cpuUsage();

function startPerformanceMonitor(/* io - no longer broadcasting */) {
    // Intervalo reducido: solo monitoreo interno, no broadcast a clientes
    // El frontend no consumía estos datos (listener comentado)
    const timer = setInterval(() => {
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage(lastCPU);
        lastCPU = process.cpuUsage();

        // Solo loguear si hay algo preocupante (evita llenar app.log con ruido)
        if (mem.heapUsed > 300 * 1024 * 1024) {
            const data = {
                rss: mem.rss,
                heapUsed: mem.heapUsed,
                cpuUser: cpu.user,
                cpuSystem: cpu.system
            };
            Logger.warn("HIGH MEMORY USAGE", data);
        }
    }, 30000); // 3s → 30s: no necesitamos monitoreo tan frecuente

    if (timer.unref) timer.unref();
}

module.exports = startPerformanceMonitor;
