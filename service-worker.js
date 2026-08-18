/* =========================================================
   Cotton Recorder — PWA Service Worker
========================================================= */

"use strict";

const CACHE_NAME = "cotton-recorder-v1";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];


/* =========================================================
   INSTALL
========================================================= */

self.addEventListener("install", (event) => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then((cache) => {

        return cache.addAll(APP_SHELL);

      })
      .then(() => {

        return self.skipWaiting();

      })

  );

});


/* =========================================================
   ACTIVATE
========================================================= */

self.addEventListener("activate", (event) => {

  event.waitUntil(

    caches.keys()
      .then((cacheNames) => {

        return Promise.all(

          cacheNames
            .filter(
              (cacheName) =>
                cacheName !== CACHE_NAME
            )
            .map(
              (cacheName) =>
                caches.delete(cacheName)
            )

        );

      })
      .then(() => {

        return self.clients.claim();

      })

  );

});


/* =========================================================
   FETCH
========================================================= */

self.addEventListener("fetch", (event) => {

  const request = event.request;

  /* Only handle GET requests */

  if(request.method !== "GET"){
    return;
  }


  const url =
    new URL(request.url);


  /* Do not cache API/OCR requests */

  if(
    url.pathname.startsWith("/api/") ||
    url.origin !== self.location.origin
  ){

    return;

  }


  /* =====================================================
     PAGE NAVIGATION
  ===================================================== */

  if(request.mode === "navigate"){

    event.respondWith(

      fetch(request)

        .then((response) => {

          if(
            response &&
            response.ok
          ){

            const copy =
              response.clone();

            caches
              .open(CACHE_NAME)
              .then((cache) => {

                cache.put(
                  "/index.html",
                  copy
                );

              });

          }

          return response;

        })

        .catch(() => {

          return caches
            .match("/index.html")
            .then((cached) => {

              if(cached){
                return cached;
              }

              return new Response(
                `
                <!doctype html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport"
                        content="width=device-width,initial-scale=1">
                  <title>Cotton Recorder</title>
                </head>
                <body>
                  <h2>Cotton Recorder</h2>
                  <p>
                    You are currently offline.
                    Please connect to the internet and try again.
                  </p>
                </body>
                </html>
                `,
                {
                  status:503,
                  headers:{
                    "Content-Type":
                      "text/html; charset=utf-8"
                  }
                }
              );

            });

        })

    );

    return;

  }


  /* =====================================================
     STATIC FILES
  ===================================================== */

  event.respondWith(

    caches.match(request)

      .then((cached) => {

        if(cached){
          return cached;
        }


        return fetch(request)

          .then((response) => {

            if(
              response &&
              response.ok
            ){

              const copy =
                response.clone();

              caches
                .open(CACHE_NAME)
                .then((cache) => {

                  cache.put(
                    request,
                    copy
                  );

                });

            }

            return response;

          });

      })

  );

});
