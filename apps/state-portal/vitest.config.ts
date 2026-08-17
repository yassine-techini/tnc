/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Le portail État est en lecture seule, mais ce qu'il lit engage l'État : la
 * réserve nationale, sa couverture, l'or prêté. Les tests visent donc deux
 * choses — que les chiffres affichés viennent bien de la réponse (le portail a
 * affiché 0 g pendant des mois parce que le client lisait des champs
 * inexistants), et que la session ne fuie pas (jetons hors du stockage local,
 * rafraîchissement en vol unique, déconnexion sur échec).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
});
