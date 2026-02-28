import './styles/main.css';

import { renderHomepage } from './ui/template';
import { bindHomepageInteractions } from './ui/interactions';

function bootstrap(): void {
  const appRoot = document.querySelector<HTMLElement>('#app');
  if (!appRoot) {
    throw new Error('Homepage mount node `#app` is missing.');
  }

  appRoot.innerHTML = renderHomepage();
  bindHomepageInteractions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
