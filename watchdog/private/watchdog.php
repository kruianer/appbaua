<?php
/**
 * Der Ausfallwächter (req-034).
 *
 * Er läuft beim Webhoster (all-inkl), NICHT auf dem Rechner, den er beobachtet
 * — genau das ist sein Sinn. Fällt der Beelink aus (Strom, Internet, appbaua
 * tot), fällt mit ihm auch die Zustandsübersicht (req-032) und die
 * Telegram-Anbindung (req-033) weg. Von diesem einen Fall soll man trotzdem
 * erfahren, und dafür muss der Melder woanders stehen.
 *
 * Er beantwortet genau eine Frage: lebt der Rechner noch? Er weiß nichts über
 * die überwachten Apps, prüft nichts selbst und kann nichts steuern. Deshalb
 * kein Framework, keine Datenbank, keine Weboberfläche — eine Datei mit dem
 * letzten Zeitpunkt reicht.
 *
 * Zwei Eingänge, beide in public/:
 *   heartbeat.php — appbaua meldet sich (alle paar Minuten);
 *   check.php     — der Cronjob des Hosters sieht nach, ob die Meldung ausblieb.
 *
 * Die Zugangsdaten (Bot-Schlüssel, Chat-Kennung, Kennung des Herzschlags)
 * stehen in der config.php NEBEN dieser Datei, also außerhalb des öffentlich
 * erreichbaren Verzeichnisses — und nie im Repo.
 *
 * PHP 7.4-tauglich gehalten: welche Version beim Hoster eingestellt ist,
 * entscheidet der Betreiber im Kundenmenü, nicht dieses Repo.
 */

/** Nach so vielen Sekunden ohne Herzschlag gilt der Rechner als ausgefallen. */
define('WATCHDOG_TIMEOUT_SECONDS', 15 * 60);

/**
 * Voreinstellungen. Alles davon lässt sich in der config.php überschreiben;
 * die drei Geheimnisse (bot_token, chat_id, token) haben bewusst KEINE
 * Voreinstellung — ohne sie soll nichts laufen.
 */
function watchdog_defaults($privateDir)
{
    return array(
        'state_file' => $privateDir . '/state.json',
        'timeout_seconds' => WATCHDOG_TIMEOUT_SECONDS,
        'timezone' => 'Europe/Berlin',
        'api_base' => 'https://api.telegram.org',
        // Welcher Rechner/welche Umgebung sich hier meldet. Steht in jeder
        // Nachricht, damit dev und prod im Chat unterscheidbar bleiben.
        'label' => 'appbaua',
    );
}

/**
 * Die config.php aus dem privaten Verzeichnis, mit den Voreinstellungen
 * verrechnet. Fehlt sie, ist der Wächter nicht eingerichtet — dann bricht er
 * ab, statt stillschweigend nichts zu tun.
 */
function watchdog_load_config($privateDir)
{
    $file = $privateDir . '/config.php';
    if (!is_file($file)) {
        throw new RuntimeException('config.php fehlt in ' . $privateDir);
    }
    $given = require $file;
    if (!is_array($given)) {
        throw new RuntimeException('config.php gibt kein Array zurück');
    }
    $config = array_merge(watchdog_defaults($privateDir), $given);
    foreach (array('bot_token', 'chat_id', 'token') as $key) {
        if (!isset($config[$key]) || trim((string) $config[$key]) === '') {
            throw new RuntimeException('config.php: ' . $key . ' fehlt');
        }
    }
    $config['timeout_seconds'] = (int) $config['timeout_seconds'];
    return $config;
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

/**
 * Was sich der Wächter zwischen zwei Aufrufen merkt:
 *  - lastBeatAt — wann der letzte Herzschlag ankam (Unix-Sekunden);
 *  - alerted    — ob zum laufenden Ausfall schon gemeldet wurde. Das ist der
 *                 Grund, warum ein tagelanger Ausfall EINE Nachricht ergibt und
 *                 nicht alle 15 Minuten eine neue (req-034);
 *  - downFrom   — der lastBeatAt zum Zeitpunkt der Meldung, also der Beginn des
 *                 Ausfalls. Aus ihm errechnet die Entwarnung ihre Dauer.
 */
function watchdog_empty_state()
{
    return array('lastBeatAt' => null, 'alerted' => false, 'downFrom' => null);
}

function watchdog_normalize_state($raw)
{
    $state = watchdog_empty_state();
    if (!is_array($raw)) {
        return $state;
    }
    if (isset($raw['lastBeatAt']) && is_numeric($raw['lastBeatAt'])) {
        $state['lastBeatAt'] = (int) $raw['lastBeatAt'];
    }
    if (isset($raw['downFrom']) && is_numeric($raw['downFrom'])) {
        $state['downFrom'] = (int) $raw['downFrom'];
    }
    $state['alerted'] = isset($raw['alerted']) && $raw['alerted'] === true;
    return $state;
}

/** Der gemerkte Zustand. Fehlt oder bricht die Datei, gilt "noch nichts". */
function watchdog_read_state($file)
{
    if (!is_file($file)) {
        return watchdog_empty_state();
    }
    $raw = @file_get_contents($file);
    if ($raw === false) {
        return watchdog_empty_state();
    }
    return watchdog_normalize_state(json_decode($raw, true));
}

/**
 * Zustand schreiben — erst daneben, dann umbenennen. Ein abgebrochener
 * Schreibvorgang darf keine halbe Datei hinterlassen: der Wächter würde sie als
 * "noch nichts" lesen und den laufenden Ausfall ein zweites Mal melden.
 */
function watchdog_write_state($file, $state)
{
    $tmp = $file . '.tmp';
    $json = json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        throw new RuntimeException('Zustand nicht schreibbar: ' . $file);
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        throw new RuntimeException('Zustand nicht schreibbar: ' . $file);
    }
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

function watchdog_plural($n, $one, $many)
{
    return $n . ' ' . ($n === 1 ? $one : $many);
}

/** Eine Dauer in Sekunden als deutscher Text: "16 Minuten", "2 Stunden 5 Minuten". */
function watchdog_format_duration($seconds)
{
    $seconds = max(0, (int) $seconds);
    if ($seconds < 60) {
        return watchdog_plural($seconds, 'Sekunde', 'Sekunden');
    }
    $minutes = intdiv($seconds, 60);
    if ($minutes < 60) {
        return watchdog_plural($minutes, 'Minute', 'Minuten');
    }
    $hours = intdiv($minutes, 60);
    $restMinutes = $minutes % 60;
    if ($hours < 24) {
        $text = watchdog_plural($hours, 'Stunde', 'Stunden');
        return $restMinutes > 0
            ? $text . ' ' . watchdog_plural($restMinutes, 'Minute', 'Minuten')
            : $text;
    }
    $days = intdiv($hours, 24);
    $restHours = $hours % 24;
    $text = watchdog_plural($days, 'Tag', 'Tage');
    return $restHours > 0
        ? $text . ' ' . watchdog_plural($restHours, 'Stunde', 'Stunden')
        : $text;
}

/** Ein Zeitpunkt in der Zeitzone des Betreibers, nicht in UTC. */
function watchdog_format_time($timestamp, $config)
{
    $date = new DateTime('@' . (int) $timestamp);
    $date->setTimezone(new DateTimeZone($config['timezone']));
    return $date->format('d.m.Y H:i') . ' Uhr';
}

/**
 * Die Ausfall-Meldung. Sie muss sich klar von einer gewöhnlichen App-Meldung
 * aus req-033 unterscheiden: dort ist EINE App kaputt und appbaua sieht noch
 * zu, hier ist der ganze Rechner weg und niemand sieht mehr etwas.
 */
function watchdog_down_text($state, $now, $config)
{
    $since = watchdog_format_duration($now - (int) $state['lastBeatAt']);
    return "\xF0\x9F\x9A\xA8 " . $config['label'] . ': Rechner meldet sich nicht'
        . "\n\n"
        . 'Seit ' . $since . ' kein Herzschlag (zuletzt '
        . watchdog_format_time($state['lastBeatAt'], $config) . ").\n\n"
        . 'Das ist NICHT der Ausfall einer einzelnen App: der Rechner selbst, '
        . 'sein Strom oder seine Internetverbindung ist weg — und damit auch '
        . 'die Überwachung. Von den überwachten Apps kommt jetzt keine Meldung '
        . 'mehr, egal wie es ihnen geht.';
}

/** Die Entwarnung — mit der Dauer des Ausfalls (req-034). */
function watchdog_up_text($state, $now, $config)
{
    $from = $state['downFrom'] !== null ? (int) $state['downFrom'] : (int) $state['lastBeatAt'];
    return "\xE2\x9C\x85 " . $config['label'] . ': Rechner ist wieder da'
        . "\n\n"
        . 'Der Herzschlag kam nach ' . watchdog_format_duration($now - $from)
        . ' Ausfall wieder an (' . watchdog_format_time($now, $config) . ').';
}

// ---------------------------------------------------------------------------
// Entscheidungen — reine Funktionen, kein I/O
// ---------------------------------------------------------------------------

/**
 * Ein Herzschlag ist angekommen. Gibt den neuen Zustand zurück und, falls ein
 * Ausfall gemeldet war, die Entwarnung.
 */
function watchdog_on_beat($state, $now, $config)
{
    $message = $state['alerted'] === true ? watchdog_up_text($state, $now, $config) : null;
    return array(
        'state' => array('lastBeatAt' => (int) $now, 'alerted' => false, 'downFrom' => null),
        'message' => $message,
    );
}

/**
 * Der Cronjob sieht nach. Gemeldet wird nur der Übergang in den Ausfall:
 *
 *  - noch nie ein Herzschlag  — nichts. Der Wächter ist dann noch nicht in
 *    Betrieb, und ein Alarm über einen Rechner, von dem er nie etwas gehört
 *    hat, wäre eine Falschmeldung;
 *  - innerhalb der Frist      — nichts. Ein Deploy-Neustart von drei Minuten
 *    läuft genau hier durch, ohne jemanden zu wecken (req-034);
 *  - Frist überschritten und noch nicht gemeldet — die eine Meldung;
 *  - Frist überschritten und schon gemeldet       — nichts. Ein tagelanger
 *    Ausfall ergibt EINE Nachricht, nicht alle 15 Minuten eine neue.
 */
function watchdog_on_check($state, $now, $config)
{
    $quiet = array('state' => $state, 'message' => null);
    if ($state['lastBeatAt'] === null || $state['alerted'] === true) {
        return $quiet;
    }
    if ($now - (int) $state['lastBeatAt'] <= (int) $config['timeout_seconds']) {
        return $quiet;
    }
    return array(
        'state' => array(
            'lastBeatAt' => (int) $state['lastBeatAt'],
            'alerted' => true,
            'downFrom' => (int) $state['lastBeatAt'],
        ),
        'message' => watchdog_down_text($state, $now, $config),
    );
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/**
 * Eine Nachricht in den hinterlegten Chat — über denselben Bot wie req-033.
 * Gibt zurück, ob sie ankam; wirft nicht, denn ein Wächter, der an seinem
 * eigenen Melder stirbt, meldet gar nichts mehr.
 */
function watchdog_send_telegram($config, $text)
{
    $url = rtrim($config['api_base'], '/') . '/bot' . $config['bot_token'] . '/sendMessage';
    $payload = json_encode(array(
        'chat_id' => (string) $config['chat_id'],
        'text' => $text,
        'disable_web_page_preview' => true,
    ));

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $body !== false && $status >= 200 && $status < 300;
    }

    // Ohne curl-Erweiterung: der Stream-Wrapper. Er braucht allow_url_fopen —
    // ist auch das aus, kommt hier nichts hinaus, und der nächste Aufruf
    // versucht es erneut.
    $context = stream_context_create(array('http' => array(
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => $payload,
        'timeout' => 15,
        'ignore_errors' => true,
    )));
    $body = @file_get_contents($url, false, $context);
    if ($body === false) {
        return false;
    }
    $status = isset($http_response_header[0]) ? $http_response_header[0] : '';
    return strpos($status, ' 2') !== false;
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

/**
 * Nachricht raus, Zustand schreiben. Scheitert der Versand, wird nur der
 * Vermerk "gemeldet"/"entwarnt" auf den Stand von vorher zurückgesetzt — der
 * Zeitpunkt des Herzschlags bleibt stehen. So versucht es der nächste Aufruf
 * erneut, statt einen Ausfall stillschweigend zu verschlucken.
 *
 * Gibt zurück, ob etwas verschickt wurde und ob es ankam.
 */
function watchdog_commit($config, $before, $result)
{
    $next = $result['state'];
    $sent = false;
    if ($result['message'] !== null) {
        $sent = watchdog_send_telegram($config, $result['message']);
        if (!$sent) {
            $next['alerted'] = $before['alerted'];
            $next['downFrom'] = $before['downFrom'];
        }
    }
    watchdog_write_state($config['state_file'], $next);
    return array('notified' => $result['message'] !== null, 'sent' => $sent);
}

/**
 * Stimmt die mitgeschickte Kennung? Ohne sie wird die Anfrage abgewiesen und
 * NICHT als Herzschlag gewertet (req-034) — sonst könnte jeder, der die Adresse
 * kennt, den Ausfall des Rechners vertuschen, indem er sie einfach aufruft.
 *
 * hash_equals statt "===": der Vergleich soll nicht über seine Laufzeit
 * verraten, wie viele Zeichen schon stimmen.
 */
function watchdog_token_ok($config, $given)
{
    $expected = (string) $config['token'];
    if ($expected === '' || !is_string($given) || $given === '') {
        return false;
    }
    return hash_equals($expected, $given);
}

/** Die Kennung aus der Anfrage: bevorzugt der Header, ersatzweise ?token=. */
function watchdog_token_from_request($server, $query)
{
    if (isset($server['HTTP_X_WATCHDOG_TOKEN'])) {
        return (string) $server['HTTP_X_WATCHDOG_TOKEN'];
    }
    if (isset($query['token'])) {
        return (string) $query['token'];
    }
    return null;
}

/** Eine JSON-Antwort und Schluss. */
function watchdog_respond($status, $body)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body);
}
