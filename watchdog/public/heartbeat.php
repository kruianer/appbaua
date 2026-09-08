<?php
/**
 * Der Eingang für den Herzschlag (req-034). appbaua ruft ihn alle paar Minuten
 * auf; mehr passiert hier nicht, als sich den Zeitpunkt zu merken — und, falls
 * ein Ausfall gemeldet war, die Entwarnung zu schicken.
 *
 * Diese Datei gehört in das ÖFFENTLICHE Web-Verzeichnis. Alles Geheime liegt
 * eine Ebene darüber, siehe ../README.md.
 */

// Wo das private Verzeichnis liegt. Voreinstellung ist die im README
// beschriebene Ablage (öffentliches Verzeichnis .../<domain>/watchdog/, privat
// daneben in .../watchdog-private/). Liegt es bei dir woanders, ist DAS hier
// die einzige Zeile, die du anpasst.
$private = getenv('WATCHDOG_PRIVATE');
if ($private === false || $private === '') {
    $private = dirname(__DIR__, 2) . '/watchdog-private';
}
require $private . '/watchdog.php';

try {
    $config = watchdog_load_config($private);
} catch (Exception $e) {
    // Kein Wort darüber, WAS fehlt: diese Antwort ist öffentlich lesbar.
    watchdog_respond(500, array('ok' => false));
    exit;
}

$token = watchdog_token_from_request($_SERVER, $_GET);
if (!watchdog_token_ok($config, $token)) {
    // Abgewiesen — und ausdrücklich NICHT als Herzschlag gewertet (req-034).
    // Der Zustand wird gar nicht erst angefasst.
    watchdog_respond(403, array('ok' => false));
    exit;
}

$now = time();
$before = watchdog_read_state($config['state_file']);
watchdog_commit($config, $before, watchdog_on_beat($before, $now, $config));

// `at` ist der Zeitpunkt, zu dem der WÄCHTER angenommen hat. appbaua zeigt
// genau diesen auf seiner Zustandsseite an — nur er beweist, dass die Strecke
// bis hierher steht.
watchdog_respond(200, array('ok' => true, 'at' => gmdate('c', $now)));
