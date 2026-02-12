"use client";

import { useEffect, useState, useRef } from "react";

export default function Display() {
  const [current, setCurrent] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const playerRef = useRef<any>(null);

  // Load queue from API
  const loadQueue = async () => {
    const res = await fetch("/api/queue");
    const data = await res.json();

    // Check if any song is playing
    let playing = data.find((q: any) => q.status === "playing");

    // If nothing is playing, start next
    if (!playing && data.length > 0) {
      await fetch("/api/next", { method: "POST" });
      const newData = await fetch("/api/queue").then((r) => r.json());
      playing = newData.find((q: any) => q.status === "playing");
    }

    setCurrent(playing);
    setQueue(data.filter((q: any) => q.status === "waiting"));
  };

  useEffect(() => {
    loadQueue();
    const interval = setInterval(loadQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load YouTube IFrame API
  useEffect(() => {
    if (!current) return;

    // Remove previous iframe
    if (playerRef.current) playerRef.current.destroy();

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    (window as any).onYouTubeIframeAPIReady = () => {
      playerRef.current = new (window as any).YT.Player("player", {
        height: "500",
        width: "100%",
        videoId: current.videoId,
        events: {
          onStateChange: (event: any) => {
            // When video ends → auto next
            if (event.data === (window as any).YT.PlayerState.ENDED) {
              handleNext();
            }
          },
        },
      });
    };
  }, [current]);

  const handlePlay = () => playerRef.current?.playVideo();
  const handlePause = () => playerRef.current?.pauseVideo();

  const handleNext = async () => {
    await fetch("/api/next", { method: "POST" });
    loadQueue();
  };

  if (!current)
    return <div className="p-10 text-center">No song playing</div>;

  return (
    <div className="p-10">
      <h1 className="text-4xl mb-4">Now Playing</h1>

      <div id="player"></div>

      <h2 className="text-2xl mt-4">{current.title}</h2>
      <p>Singer: {current.singerName}</p>

      {/* Play / Pause / Next Controls */}
      <div className="mt-4 flex gap-4">
        <button
          onClick={handlePlay}
          className="bg-green-500 text-white px-4 py-2"
        >
          Play
        </button>
        <button
          onClick={handlePause}
          className="bg-yellow-500 text-white px-4 py-2"
        >
          Pause
        </button>
        <button
          onClick={handleNext}
          className="bg-red-500 text-white px-4 py-2"
        >
          Next
        </button>
      </div>

      <div className="mt-6">
        <h3>Next Songs:</h3>
        {queue.slice(0, 5).map((q) => (
          <p key={q.id}>
            {q.title} - {q.singerName}
          </p>
        ))}
      </div>
    </div>
  );
}
