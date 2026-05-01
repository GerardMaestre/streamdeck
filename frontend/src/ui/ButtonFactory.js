/**
 * ButtonFactory — Creates grid buttons and provides help text.
 */

/**
 * Map of script label keys to human-friendly descriptions.
 */
const scriptDescriptions = {
    'activar win 11': 'Activa optimizaciones y ajustes recomendados para Windows 11.',
    'quitar bloatware': 'Desinstala aplicaciones y componentes no deseados de Windows.',
    'god mode': 'Activa el menú oculto de configuración avanzada de Windows.',
    'salud disco': 'Revisa el estado del disco y corrige problemas básicos.',
    'limpiar ram': 'Libera memoria RAM cerrando procesos temporales y caché.',
    'anti stuttering': 'Reduce micro-tartamudeos en juegos cerrando tareas innecesarias.',
    'modo tryhard': 'Maximiza el rendimiento del CPU para sesiones exigentes.',
    'ping optimizer': 'Optimiza la conexión de red para reducir latencia.',
    'asesino zombies': 'Cierra procesos inactivos y aplicaciones de "zombies" que consumen recursos.',
    'mac spoofer': 'Cambia la dirección MAC para proteger tu privacidad en red.',
    'identidad falsa': 'Genera un perfil de red falso y mejora tu anonimato en línea.',
    'panic button': 'Ejecuta una acción rápida de emergencia para cerrar o proteger el sistema.',
    'limpieza extrema': 'Realiza una limpieza profunda de archivos temporales y basura del sistema.',
    'buscador dupl': 'Busca y elimina archivos duplicados para liberar espacio.',
    'organizador': 'Organiza archivos y carpetas según reglas predefinidas.',
    'servidor desc': 'Lanza el servidor de descargas para gestionar descargas locales.',
    'descargador': 'Inicia el descargador maestro para bajar archivos automáticamente.',
    'spicetify': 'Aplica temas personalizados a Spotify usando Spicetify.',
    'macros': 'Abre el gestor de macros para automatizar tareas repetitivas.',
    'cloud gaming': 'Configura accesos rápidos para servicios de gaming en la nube.',
    'purgar ram': 'Limpia la memoria RAM liberando caché y procesos temporales.',
    'purgador shaders': 'Elimina shaders temporales para forzar regeneración limpia.',
    'despertar nucleos': 'Activa todos los núcleos del procesador para alto rendimiento.',
    'limpieza extrema global': 'Ejecuta una limpieza profunda general del sistema.'
};

const normalizeKey = (text = '') =>
    text.toString().trim().toLowerCase().replace(/[._\-]+/g, ' ').replace(/\s+/g, ' ');

/**
 * Returns a human-friendly help text for a button config.
 */
export function getButtonHelpText(btnData) {
    if (btnData.helpText) return btnData.helpText;

    if (btnData.type === 'folder' || btnData.targetPage) {
        return `Abre la pantalla "${btnData.label || btnData.targetPage}".`;
    }
    if (btnData.type === 'mixer') return 'Abre los controles de audio y volumen del mezclador.';
    if (btnData.type === 'discord_panel') return 'Abre el panel de Discord para gestionar mute y volumen.';
    if (btnData.type === 'domotica_panel') return 'Abre el panel de domótica para controlar tus dispositivos.';

    if (btnData.type === 'action') {
        const action = btnData.action || btnData.channel;
        const labelKey = normalizeKey(btnData.label);
        const fileKey = normalizeKey(btnData.payload?.archivo || btnData.payload?.label || '');
        const mapKey = labelKey || fileKey;
        if (mapKey && scriptDescriptions[mapKey]) return scriptDescriptions[mapKey];

        switch (action) {
            case 'abrir_keep': return 'Abre Google Keep en tu equipo.';
            case 'abrir_calendario': return 'Abre Google Calendar en tu equipo.';
            case 'cambiar_resolucion':
                return `Cambia la resolución de pantalla a ${btnData.payload?.width || '?'}x${btnData.payload?.height || '?'}.`;
            case 'apagar_pc': return 'Apaga el equipo de forma segura.';
            case 'reiniciar_pc': return 'Reinicia el equipo de forma segura.';
            case 'minimizar_todo': return 'Minimiza todas las ventanas abiertas.';
            case 'ejecutar_script': return `Ejecuta el script "${btnData.payload || 'desconocido'}".`;
            case 'ejecutar_script_dinamico':
                return `Ejecuta el script "${btnData.payload?.archivo || 'desconocido'}" de la carpeta "${btnData.payload?.carpeta || '?'}".`;
            default:
                if (btnData.channel === 'tuya_command') return 'Envía un comando a tus dispositivos domóticos.';
                if (btnData.channel === 'multimedia') return `Control multimedia: ${btnData.action || 'acción'}.`;
                if (btnData.channel === 'macro') return `Ejecuta la macro ${btnData.payload || btnData.action}.`;
                return `Ejecuta la acción ${action || btnData.label || 'desconocida'}.`;
        }
    }

    return `Botón: ${btnData.label || 'Acción desconocida'}.`;
}

/**
 * Creates a grid button DOM element from config data.
 */
export function createButton(btnData, index, buttonStateMap, skipAnimation = false) {
    const btn = document.createElement('button');
    btn.className = 'boton btn-streamdeck';
    if (btnData.color) btn.style.background = btnData.color;

    if (skipAnimation) {
        btn.style.animation = 'none';
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1)';
        btn.style.transition = 'none';
    } else {
        btn.style.animationDelay = `${index * 0.05}s`;
    }

    const iconEl = document.createElement('div');
    iconEl.className = 'button-icon';
    iconEl.innerHTML = btnData.icon || '';

    const labelEl = document.createElement('div');
    labelEl.className = 'button-label';
    labelEl.textContent = btnData.label || '';

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);

    buttonStateMap.set(btn, {
        btnData,
        longPressTimer: null,
        startPos: null,
        longPressHandled: false
    });

    return btn;
}

/**
 * Creates a back button for sub-page navigation.
 */
export function createBackButton(index, onBack, buttonStateMap) {
    const backBtn = document.createElement('button');
    backBtn.className = 'boton btn-streamdeck btn-back-gradient';
    backBtn.style.animationDelay = `${index * 0.05}s`;
    backBtn.innerHTML = '<span class="icon">⬅️</span>Volver';

    // Lo registramos en el mapa de estados para que StreamDeckApp lo reconozca
    buttonStateMap.set(backBtn, {
        btnData: { type: 'back', onBack },
        longPressTimer: null,
        startPos: null,
        longPressHandled: false
    });

    return backBtn;
}

/**
 * Creates a panel back button (circle style).
 */
export function createPanelBackButton(onClick) {
    const existing = document.getElementById('panel-back-button');
    if (existing) existing.remove();

    const backBtn = document.createElement('button');
    backBtn.id = 'panel-back-button';
    // Usamos ambas clases para asegurar compatibilidad con estilos locales y globales
    backBtn.className = 'panel-back-btn-sketch-circle back-btn-sketch-circle';
    backBtn.innerHTML = '<span>←</span>';

    backBtn.addEventListener('pointerdown', () => {
        backBtn.classList.add('pressing');
    });

    const release = () => {
        backBtn.classList.remove('pressing');
    };

    backBtn.addEventListener('pointerup', release);
    backBtn.addEventListener('pointercancel', release);

    backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (navigator.vibrate) navigator.vibrate(50);

        // Escudo anti-rebote temporal
        const shield = document.createElement('div');
        shield.className = 'pointer-shield';
        document.body.appendChild(shield);
        setTimeout(() => shield.remove(), 400);

        if (onClick) onClick();
        backBtn.remove();
    });

    return backBtn;
}
