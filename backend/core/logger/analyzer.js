const fs = require("fs");
const path = require("path");

const { getDataPath } = require("../../utils/utils");

function analyzeLogs() {
    const errorFile = getDataPath("logs/errors.log");
    
    if (!fs.existsSync(errorFile)) {
        console.log("📊 ERROR REPORT: No errors found. System is clean!");
        return { totalErrors: 0, frequentErrors: {} };
    }

    const logs = fs.readFileSync(errorFile, "utf-8");
    const errors = logs.split("\n").filter(l => l.includes("ERROR"));

    const report = {
        totalErrors: errors.length,
        frequentErrors: {},
    };

    errors.forEach(e => {
        // Formato esperado: [timestamp] ERROR: msg | stack | meta
        // Extraemos el tipo de error (msg)
        const parts = e.split("ERROR: ");
        if (parts.length > 1) {
            const errorSection = parts[1].split("|")[0].trim();
            report.frequentErrors[errorSection] = (report.frequentErrors[errorSection] || 0) + 1;
        }
    });

    console.log("📊 ERROR REPORT:", report);
    return report;
}

// Permitir ejecucion directa desde terminal
if (require.main === module) {
    analyzeLogs();
}

module.exports = analyzeLogs;
