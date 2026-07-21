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
