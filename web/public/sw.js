/* Freebie Finder service worker — handles web push notifications. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Freebie Finder", body: event.data && event.data.text() };
  }
  const title = data.title || "🎁 New free game";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon.png",
      badge: "/icon.png",
      image: data.image,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(clients.openWindow(url));
});
