// Reine Mustererkennung für Netzwerkfehler — bewusst ohne jeden Import.
//
// Warum eine eigene Datei: Diese Prüfung wird an beiden Enden gebraucht, im
// Worker (bug-020, Wiederholversuch bei git) und in der Oberfläche (req-037,
// Einordnung im Verlauf). Sie lag ursprünglich in `workspace.ts` — und die
// zieht `node:path`, `node:fs` und Kindprozesse mit sich. Ein Import von dort
// in eine Komponente lässt den Next.js-Build scheitern, weil der Browser mit
// node-Modulen nichts anfangen kann.
//
// Dasselbe Muster wie `auth-cookie-name.ts` (req-023): Was beide Seiten
// brauchen, gehört in eine Datei, die nichts nachzieht.

/**
 * Sieht das nach einer vorübergehenden Netzwerkstörung aus — etwas, das ein
 * zweiter Versuch beheben könnte?
 *
 * Bewusst NICHT enthalten: fehlender Zugang, unbekanntes Repo, abgelehnter
 * Token. Die scheitern beim zweiten Mal genauso, und ein Wiederholversuch wäre
 * nur verlorene Zeit.
 */
export function isTransientNetworkError(stderr: string): boolean {
  return /Failed to connect|Could not connect to server|Connection timed out|Connection refused|Connection reset by peer|Could not resolve host|Could not resolve proxy|Operation timed out|Recv failure|Send failure|Empty reply from server|The remote end hung up unexpectedly|early EOF|\[timeout\]/i.test(
    stderr,
  );
}
