// src/Root.tsx
//
// App shell that wires the service-worker update prompt to the
// UpdateBanner. Kept out of unit tests/coverage because it depends on the
// virtual:pwa-register runtime; the banner's behavior is tested via the
// pure UpdateBanner component.

import { useRegisterSW } from "virtual:pwa-register/react";
import App from "./App";
import UpdateBanner from "./components/UpdateBanner";

export default function Root() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onOfflineReady() {
      console.log("Finance Cockpit is ready to work offline.");
    },
    onRegisteredSW(_swUrl, registration) {
      // A prompt-mode SW only surfaces a new version while the app is
      // open. Poll hourly (and on tab refocus) so a long-open session
      // actually catches a deploy and shows the update banner, instead
      // of only picking it up silently on the next full app restart.
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) registration.update();
      };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });

  return (
    <>
      <App />
      <UpdateBanner
        visible={needRefresh}
        onRefresh={() => updateServiceWorker(true)}
        onDismiss={() => setNeedRefresh(false)}
      />
    </>
  );
}
