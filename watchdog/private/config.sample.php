<?php
/**
 * Vorlage für die config.php des Ausfallwächters (req-034).
 *
 * Kopiere diese Datei beim Hoster nach `config.php` NEBEN die watchdog.php —
 * also außerhalb des öffentlich erreichbaren Verzeichnisses — und trage die
 * drei Werte ein. Die ausgefüllte config.php gehört NIE ins Repo.
 */

return array(
    // Der Bot-Schlüssel von @BotFather. Derselbe Bot wie in req-033.
    'bot_token' => 'HIER-DER-BOT-SCHLUESSEL',

    // Die eine Chat-Kennung, in die gemeldet wird.
    'chat_id' => 'HIER-DIE-CHAT-KENNUNG',

    // Die gemeinsame Kennung des Herzschlags. Muss Zeichen für Zeichen dem
    // WATCHDOG_TOKEN in der env-Datei der appbaua-Umgebung entsprechen.
    // Etwas Langes, Zufälliges — z.B. `openssl rand -hex 32`.
    'token' => 'HIER-DIE-KENNUNG-DES-HERZSCHLAGS',

    // --- ab hier optional, die Voreinstellungen passen meistens ---

    // Wie lange der Herzschlag ausbleiben darf, bevor gemeldet wird.
    // 'timeout_seconds' => 15 * 60,

    // Steht in jeder Nachricht. Bei zwei Umgebungen (dev und prod) bekommt jede
    // ihren EIGENEN Wächter mit eigenem Label, sonst ist im Chat nicht
    // erkennbar, welcher Rechner sich nicht meldet.
    // 'label' => 'appbaua prod',

    // Zeitzone der Zeitangaben in den Nachrichten.
    // 'timezone' => 'Europe/Berlin',

    // Wo der letzte Zeitpunkt liegt. Voreinstellung: state.json neben dieser
    // Datei. Das Verzeichnis muss für PHP beschreibbar sein.
    // 'state_file' => __DIR__ . '/state.json',
);
