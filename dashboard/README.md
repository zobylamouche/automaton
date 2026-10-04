# Tableau de bord Automaton (lecture seule)

Affiche en direct l'état d'un agent : solde, niveau de survie, gains et dépenses, journal, enfants.

    npm install
    npm run dashboard            # puis ouvrir http://127.0.0.1:4173

Options : `--db <chemin>` (défaut `~/.automaton/state.db`) et `--port <n>`.

- Lecture seule : la base est ouverte en `readonly`, le serveur n'accepte que GET.
- Écoute uniquement sur 127.0.0.1 (jamais exposé au réseau).
- Sans base trouvée, la page l'indique. Sans serveur (fichier ouvert seul), elle montre une simulation.
