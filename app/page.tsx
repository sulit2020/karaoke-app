"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type Video = {
  videoId: string;
  title?: string | null;
  thumbnail?: string | null;
};

type QueueItem = {
  id: number;
  videoId: string;
  title?: string | null;
  thumbnail?: string | null;
  singerName?: string | null;
};

export default function Page() {
  // UI state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Video[]>([]);
  const [name, setName] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // player + queue state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number | null>(null);
  const currentQueueIndexRef = useRef<number | null>(null);

  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);

  // Next-soon prompt
  const [showNextSoon, setShowNextSoon] = useState(false);
  const [nextSoonTitle, setNextSoonTitle] = useState<string | null>(null);

  // refs for YT player
  const playerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any | null>(null);
  const ytAPILoadPromiseRef = useRef<Promise<void> | null>(null);
  const nextSoonTimeoutRef = useRef<number | null>(null);
  const nextSoonIntervalRef = useRef<number | null>(null);

  // helper: show toast
  const showToast = (kind: "success" | "error", message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 3000);
  };

  // search API
  const search = async () => {
    try {
      const res = await fetch(`/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      setResults(data || []);
    } catch (err) {
      console.error('search error', err);
      showToast("error", "Search failed");
    }
  };

  // fetch queue
  const fetchQueue = async () => {
    try {
      const res = await fetch("/api/queue");
      if (!res.ok) throw new Error("queue fetch failed");
      const data = await res.json();
      setQueue(data || []);
      queueRef.current = data || [];
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  // reserve with basic retry/backoff
  const reserve = async (video: Video) => {
    if (!name) {
      showToast("error", "Please enter your name before reserving");
      return;
    }

    setPendingCount((c) => c + 1);
    let attempts = 0;
    let lastErr: any = null;
    while (attempts < 3) {
      attempts++;
      try {
        const res = await fetch("/api/reserve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: video.videoId, title: video.title, thumbnail: video.thumbnail, singerName: name }),
        });
        if (!res.ok) throw new Error("reserve failed");
        const created = await res.json();
        // append locally for immediate UX
        const next = [ ...(queueRef.current || []), created ];
        setQueue(next);
        queueRef.current = next;
        showToast("success", "Reserved");
        setPendingCount((c) => c - 1);
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * attempts));
      }
    }
    setPendingCount((c) => c - 1);
    showToast("error", "Failed to reserve: " + (lastErr?.message || ""));
  };

  // decode html entities
  function htmlspecialchars(title: string | null | undefined) {
    if (title == null) return null;
    try {
      const doc = new DOMParser().parseFromString(title, "text/html");
      return doc.documentElement.textContent || title;
    } catch {
      return title;
    }
  }

  // ensure YT API loaded and create player
  const ensureAPI = async (videoId?: string, requestFullscreen = true) => {
    if (!ytAPILoadPromiseRef.current) {
      if ((window as any).YT && (window as any).YT.Player) {
        ytAPILoadPromiseRef.current = Promise.resolve();
      } else {
        ytAPILoadPromiseRef.current = new Promise((resolve) => {
          const existing = document.getElementById("youtube-iframe-api");
          if (!existing) {
            const tag = document.createElement("script");
            tag.id = "youtube-iframe-api";
            tag.src = "https://www.youtube.com/iframe_api";
            document.body.appendChild(tag);
          }
          (window as any).onYouTubeIframeAPIReady = () => resolve();
        });
      }
    }

    await ytAPILoadPromiseRef.current;

    // attach/destroy player
    if (!playerRef.current) return;

    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.destroy(); } catch { }
      ytPlayerRef.current = null;
    }

    if (requestFullscreen) {
      try {
        if (playerRef.current && (playerRef.current as any).requestFullscreen) await (playerRef.current as any).requestFullscreen();
      } catch { /* ignore fullscreen errors */ }
    }

  // debug origin used for YT player
  try { console.debug('Creating YT player with origin', window.location.origin); } catch {}

  // prefer passing the element id to YT.Player (avoids some widgetapi targetWindow issues)
  const playerElementId = document.getElementById('youtube-player-iframe') ? 'youtube-player-iframe' : 'youtube-player';
  ytPlayerRef.current = new (window as any).YT.Player(playerElementId, {
      height: '100%',
      width: '100%',
      videoId: videoId || undefined,
      playerVars: { autoplay: 1, controls: 1, origin: window.location.origin },
      events: {
        onStateChange: async (event: any) => {
          const YT = (window as any).YT;
          if (event.data === YT?.PlayerState?.PLAYING) {
            // schedule next-soon
            try {
              if (nextSoonTimeoutRef.current) { clearTimeout(nextSoonTimeoutRef.current); nextSoonTimeoutRef.current = null; }
              const p = ytPlayerRef.current;
              const dur = p.getDuration();
              const cur = p.getCurrentTime();
              const remaining = dur - cur;
              const q = queueRef.current || [];
              const nextIdx = currentQueueIndexRef.current === null ? 0 : currentQueueIndexRef.current + 1;
              const nextItem = q[nextIdx];
              if (nextItem && remaining > 15) {
                nextSoonTimeoutRef.current = window.setTimeout(() => {
                  setShowNextSoon(true);
                  setNextSoonTitle(nextItem.title || nextItem.videoId);
                }, (remaining - 15) * 1000);
              } else if (nextItem && remaining <= 15) {
                setShowNextSoon(true);
                setNextSoonTitle(nextItem.title || nextItem.videoId);
              }
            } catch { }
          }

          if (event.data === (window as any).YT?.PlayerState?.ENDED) {
            // handle end: if playing from queue, delete and advance; otherwise reserve then play queue
            (async () => {
              const qIndex = currentQueueIndexRef.current;
              if (qIndex !== null && qIndex !== undefined) {
                const prev = queueRef.current[qIndex];
                if (prev && prev.id) {
                  try { await fetch('/api/queue', { method: 'DELETE', body: JSON.stringify({ id: prev.id }) }); } catch { }
                }

                // refresh
                try {
                  const r = await fetch('/api/queue');
                  if (r.ok) {
                    const newQ = await r.json();
                    setQueue(newQ);
                    queueRef.current = newQ;
                    if (newQ.length > qIndex) {
                      const next = newQ[qIndex];
                      setCurrentQueueIndex(qIndex);
                      currentQueueIndexRef.current = qIndex;
                      try { ytPlayerRef.current.loadVideoById(next.videoId); setCurrentlyPlaying(next.videoId); setCurrentVideo({ videoId: next.videoId, title: next.title, thumbnail: next.thumbnail }); } catch { }
                    } else {
                      // no next
                      setCurrentQueueIndex(null); currentQueueIndexRef.current = null;
                      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { }
                      try { ytPlayerRef.current.destroy(); ytPlayerRef.current = null; } catch { }
                      setCurrentlyPlaying(null); setCurrentVideo(null);
                    }
                  }
                } catch { }
              } else {
                // not from queue: reserve current and play queue if any
                try { await fetch('/api/reserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: currentVideo?.videoId, title: currentVideo?.title, thumbnail: currentVideo?.thumbnail, singerName: name }) }); } catch { }
                try {
                  const r2 = await fetch('/api/queue');
                  if (r2.ok) {
                    const newQ2 = await r2.json();
                    setQueue(newQ2);
                    queueRef.current = newQ2;
                    if (newQ2.length > 0) {
                      const next = newQ2[0];
                      setCurrentQueueIndex(0); currentQueueIndexRef.current = 0;
                      try { if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') { ytPlayerRef.current.loadVideoById(next.videoId); setCurrentlyPlaying(next.videoId); setCurrentVideo({ videoId: next.videoId, title: next.title, thumbnail: next.thumbnail }); } else { await ensureAPI(next.videoId, false); } } catch { }
                    } else {
                      try { await stop(); } catch { }
                    }
                  }
                } catch { }
              }
            })();
          }

          if (event.data === (window as any).YT?.PlayerState?.PAUSED || event.data === (window as any).YT?.PlayerState?.BUFFERING) {
            if (nextSoonTimeoutRef.current) { clearTimeout(nextSoonTimeoutRef.current); nextSoonTimeoutRef.current = null; }
            setShowNextSoon(false);
            setNextSoonTitle(null);
          }
        },
      },
    });
  };

  const play = async (video: Video) => {
    setCurrentVideo(video);
    setCurrentlyPlaying(video.videoId);
    // if playing a queued item, set currentQueueIndex
    const idx = (queueRef.current || []).findIndex((q) => q.videoId === video.videoId);
    if (idx !== -1) {
      setCurrentQueueIndex(idx);
      currentQueueIndexRef.current = idx;
    } else {
      setCurrentQueueIndex(null);
      currentQueueIndexRef.current = null;
    }

    // request fullscreen synchronously while still in the user gesture
    try {
      if (playerRef.current && (playerRef.current as any).requestFullscreen) {
        (playerRef.current as any).requestFullscreen().catch(() => {});
      }
    } catch { }

    // If YT API isn't loaded yet, create an iframe with autoplay=1 synchronously
    const apiLoaded = !!(window as any).YT && !!(window as any).YT.Player;
    if (!apiLoaded) {
      try {
        const container = document.getElementById('youtube-player');
        if (container) {
          // remove old children
          container.innerHTML = '';
          const iframe = document.createElement('iframe');
          iframe.id = 'youtube-player-iframe';
          const origin = encodeURIComponent(window.location.origin || '');
          iframe.src = `https://www.youtube.com/embed/${video.videoId}?enablejsapi=1&autoplay=1&controls=1&origin=${origin}`;
          iframe.allow = 'autoplay; fullscreen';
          iframe.allowFullscreen = true;
          iframe.width = '100%';
          iframe.height = '100%';
          iframe.style.border = '0';
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          container.appendChild(iframe);
        }
      } catch { }

      // still attempt to load API in background so we can attach events later
      ensureAPI(video.videoId, false).catch(() => {});
      return;
    }

    // API is already available — use usual player creation
    await ensureAPI(video.videoId, false);
  };

  const stop = async () => {
    setCurrentlyPlaying(null);
    setCurrentVideo(null);
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { }
    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.destroy(); } catch { }
      ytPlayerRef.current = null;
    }
    // if we created a plain iframe for autoplay, remove it
    try {
      const container = document.getElementById('youtube-player');
      if (container) container.innerHTML = '';
    } catch { }
  };

  // play next reserved (alias for UI button)
  const playNextReserved = async () => {
    const q = queueRef.current || [];
    if (!q || q.length === 0) return;
    const curIdx = currentQueueIndexRef.current;
    if (curIdx !== null && curIdx !== undefined) {
      const prev = q[curIdx];
      if (prev && prev.id) {
        try { await fetch('/api/queue', { method: 'DELETE', body: JSON.stringify({ id: prev.id }) }); } catch { }
      }
    }

    // refresh
    try {
      const r = await fetch('/api/queue');
      if (r.ok) {
        const newQ = await r.json();
        setQueue(newQ); queueRef.current = newQ;
        const nextIndex = curIdx ?? 0;
        const next = newQ[nextIndex];
        if (!next) {
          setCurrentQueueIndex(null); currentQueueIndexRef.current = null; setCurrentlyPlaying(null); setCurrentVideo(null); return;
        }
        setCurrentQueueIndex(nextIndex); currentQueueIndexRef.current = nextIndex;
        if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
          try { ytPlayerRef.current.loadVideoById(next.videoId); setCurrentlyPlaying(next.videoId); setCurrentVideo({ videoId: next.videoId, title: next.title, thumbnail: next.thumbnail }); } catch { }
        } else {
          await play({ videoId: next.videoId, title: next.title, thumbnail: next.thumbnail });
        }
      }
    } catch { }

    setShowNextSoon(false); setNextSoonTitle(null);
  };

  // Skip to next reserved song immediately
  const skipToNextSong = async () => {
    const q = queueRef.current || [];
    if (!q || q.length === 0) return;
    const curIdx = currentQueueIndexRef.current;
    if (curIdx !== null && curIdx !== undefined) {
      const prev = q[curIdx];
      if (prev && prev.id) {
        try { await fetch('/api/queue', { method: 'DELETE', body: JSON.stringify({ id: prev.id }) }); } catch { }
      }
    }

    try {
      const r = await fetch('/api/queue');
      if (r.ok) {
        const newQ = await r.json();
        setQueue(newQ); queueRef.current = newQ;
        const nextIndex = curIdx ?? 0;
        const next = newQ[nextIndex];
        if (!next) { setCurrentQueueIndex(null); currentQueueIndexRef.current = null; if (ytPlayerRef.current) { try { ytPlayerRef.current.destroy(); } catch { } ytPlayerRef.current = null; } setCurrentlyPlaying(null); setCurrentVideo(null); return; }
        setCurrentQueueIndex(nextIndex); currentQueueIndexRef.current = nextIndex;
        if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
          try { ytPlayerRef.current.loadVideoById(next.videoId); setCurrentlyPlaying(next.videoId); setCurrentVideo({ videoId: next.videoId, title: next.title, thumbnail: next.thumbnail }); } catch { }
        } else {
          await play({ videoId: next.videoId, title: next.title, thumbnail: next.thumbnail });
        }
      }
    } catch { }

    setShowNextSoon(false); setNextSoonTitle(null);
  };

  // poller fallback for next-soon
  useEffect(() => {
    if (nextSoonIntervalRef.current) { clearInterval(nextSoonIntervalRef.current); nextSoonIntervalRef.current = null; }
    if (!currentlyPlaying) {
      setShowNextSoon(false); setNextSoonTitle(null); return;
    }

    nextSoonIntervalRef.current = window.setInterval(() => {
      try {
        const p = ytPlayerRef.current;
        if (!p || typeof p.getDuration !== 'function' || typeof p.getCurrentTime !== 'function') return;
        const dur = p.getDuration();
        const cur = p.getCurrentTime();
        const remaining = dur - cur;
        const q = queueRef.current || [];
        const nextIdx = currentQueueIndexRef.current === null ? 0 : currentQueueIndexRef.current + 1;
        const nextItem = q[nextIdx];
        if (remaining <= 15 && nextItem) {
          if (!showNextSoon) { setShowNextSoon(true); setNextSoonTitle(nextItem.title || nextItem.videoId); }
        } else {
          if (showNextSoon) { setShowNextSoon(false); setNextSoonTitle(null); }
        }
      } catch { }
    }, 1000);

    return () => { if (nextSoonIntervalRef.current) { clearInterval(nextSoonIntervalRef.current); nextSoonIntervalRef.current = null; } };
  }, [currentlyPlaying, showNextSoon]);

  // cleanup
  useEffect(() => {
    return () => {
      if (ytPlayerRef.current) { try { ytPlayerRef.current.destroy(); } catch { } ytPlayerRef.current = null; }
      if ((window as any).onYouTubeIframeAPIReady) (window as any).onYouTubeIframeAPIReady = undefined;
      if (nextSoonIntervalRef.current) { clearInterval(nextSoonIntervalRef.current); nextSoonIntervalRef.current = null; }
      if (nextSoonTimeoutRef.current) { clearTimeout(nextSoonTimeoutRef.current); nextSoonTimeoutRef.current = null; }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-red-600 rounded px-2 py-1 flex items-center gap-2 text-white font-semibold">
              <svg width="18" height="12" viewBox="0 0 24 24" fill="none" className="-ml-1">
                <path d="M5 3v18l15-9L5 3z" fill="currentColor" />
              </svg>
              Karaoke
            </div>
          </div>

          <div className="flex-1 px-6">
            <div className="max-w-2xl mx-auto flex items-center">
              <input
                className="flex-1 border rounded-l-full p-2 px-4 shadow-sm"
                placeholder="Search songs, artists..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
              />
              <button onClick={search} className="bg-gray-100 border-l px-4 rounded-r-full">Search</button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              className="border p-2 rounded shadow-sm"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {pendingCount > 0 && (
              <div className="text-sm text-yellow-600">Pending: {pendingCount}</div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        <section className="lg:col-span-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((video) => (
              <article key={video.videoId} className="bg-white rounded-md shadow hover:shadow-lg overflow-hidden">
                <div className="relative bg-black h-48">
                  {video.thumbnail ? (
                    <Image src={video.thumbnail} alt={video.title || 'thumbnail'} fill style={{ objectFit: 'cover' }} />
                  ) : null}
                  <button onClick={() => play(video)} className="absolute left-3 top-3 bg-black/40 text-white rounded-full p-2">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 3v18l15-9L5 3z" fill="currentColor" /></svg>
                  </button>
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-medium line-clamp-2">{htmlspecialchars(video.title) || 'Untitled'}</h3>
                  <div className="text-xs text-gray-500 mt-1">{name ? `Reserved by ${name}` : ''}</div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => reserve(video)} className="text-sm bg-red-600 text-white px-3 py-1 rounded">Reserve</button>
                    <button onClick={() => play(video)} className="text-sm bg-gray-200 px-3 py-1 rounded">Play</button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* player area */}
          <div className="mt-6">
            <div ref={playerRef} className="mt-6">
              {currentlyPlaying && (
                <div className="w-full bg-black rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between p-3">
                    <h3 className="text-white font-semibold">Now playing</h3>
                    <div className="flex items-center gap-2">
                      <button onClick={stop} className="text-sm text-gray-200 bg-white/10 px-3 py-1 rounded">Close</button>
                    </div>
                  </div>
                  <div className="w-full h-[60vh] md:h-[75vh]">
                    <div id="youtube-player" className="w-full h-full" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="lg:col-span-1 sticky top-6">
          <div className="bg-white rounded-md shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">Reserved Songs</h4>
              <div className="flex items-center gap-2">
                <button onClick={playNextReserved} className="bg-indigo-600 text-white px-3 py-1 rounded">Next</button>
                <button onClick={fetchQueue} className="text-sm text-gray-600">Refresh</button>
              </div>
            </div>

            <div className="space-y-2">
              {queue.length === 0 && <div className="text-sm text-gray-500">No reserved songs</div>}
              {queue.map((item, idx) => (
                <div key={item.id} className={`p-2 rounded flex items-center justify-between ${currentQueueIndex === idx ? 'bg-indigo-50' : ''}`}>
                  <div>
                    <div className="font-medium text-sm">{htmlspecialchars(item.title)}</div>
                    <div className="text-xs text-gray-500">{item.singerName}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setCurrentQueueIndex(idx); currentQueueIndexRef.current = idx; play({ videoId: item.videoId, title: item.title, thumbnail: item.thumbnail }); }} className="px-2 py-1 bg-green-500 text-white rounded text-sm">Play</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Toast notification */}
        {toast && (
          <div className={`fixed bottom-6 right-6 px-4 py-2 rounded shadow-lg ${toast.kind === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.message}
          </div>
        )}

        {/* Next Soon prompt (15s before end) */}
        {showNextSoon && nextSoonTitle && (
          <div className="fixed top-6 right-6 z-50">
            <div className="bg-yellow-400 text-black px-4 py-2 rounded shadow-lg flex items-center gap-3">
              <div className="text-sm">Next: <strong>{nextSoonTitle}</strong></div>
              <button onClick={skipToNextSong} className="bg-black text-white px-3 py-1 rounded">Next Song</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
