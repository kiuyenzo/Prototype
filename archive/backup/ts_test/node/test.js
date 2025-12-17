
//zum laufen bringen: node test.js
// Fast alle Veramo - Funktionen sind asynchron.
// Darum musst du async / await verstehen.

// Merke:
// async macht eine Funktion asynchron
// await wartet auf ein Ergebnis
// Ohne async / await → Veramo funktioniert nicht


async function main() {
    console.log("Starte...");

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log("Fertig!");
}

main();


// output:
// Starte...
// (1 Sekunde Pause)
// Fertig!
