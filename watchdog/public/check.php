<?php
/**
 * Die regelmäßige Nachschau (req-034): blieb der Herzschlag länger als die
 * eingestellte Frist aus? Dann geht EINE Telegram-Nachricht hinaus.
 *
 * Angestoßen wird das vom Cronjob im Kundenmenü des Hosters — der Wächter hat
 * selbst keinen Takt, weil es dort keine Hintergrunddienste gibt. Das
 * Einrichten des Cronjobs ist ein manueller Schritt des Betreibers, siehe
 * ../README.md.
 *
 * Über HTTP aufgerufen (URL-Cronjob) braucht auch dieser Eingang die Kennung;
 * als CLI-Skript aufgerufen nicht, denn dort kommt niemand von außen hin.
 */

$private = getenv('WATCHDOG_PRIVATE');
if ($private === false || $private === '') {
    $private = dirname(__DIR__, 2) . '/watchdog-private';
}
require $private . '/watchdog.php';

$cli = PHP_SAPI === 'cli';

try {
    $config = watchdog_load_config($private);
} catch (Exception $e) {
    if ($cli) {
        fwrite(STDERR, $e->getMessage() . "\n");
        exit(1);
    }
    watchdog_respond(500, array('ok' => false));
    exit;
}

if (!$cli && !watchdog_token_ok($config, watchdog_token_from_request($_SERVER, $_GET))) {
    watchdog_respond(403, array('ok' => false));
    exit;
}

$now = time();
$before = watchdog_read_state($config['state_file']);
$outcome = watchdog_commit($config, $before, watchdog_on_check($before, $now, $config));

if ($cli) {
    echo ($outcome['notified'] ? ($outcome['sent'] ? "gemeldet\n" : "Versand fehlgeschlagen\n") : "still\n");
    exit(0);
}
watchdog_respond(200, array('ok' => true, 'notified' => $outcome['notified']));
