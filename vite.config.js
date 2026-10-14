import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
	},
<<<<<<< HEAD
=======
	server: {
		proxy: {
			'/api': 'http://localhost:3000',
		},
	},
>>>>>>> b486d065cb59b63d9f1bc6445334ca0122d71301
	appType: 'spa',
});