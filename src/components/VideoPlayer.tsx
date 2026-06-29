import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Maximize, Download, ExternalLink, Video } from 'lucide-react';

interface VideoPlayerProps {
  title: string;
  thumbnail?: string;
  videoUrl: string;
  duration?: number;
  source?: string;
  downloadUrl?: string;
}

export default function VideoPlayer({ title, thumbnail, videoUrl, duration, source, downloadUrl }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const playPromiseRef = useRef<Promise<void> | null>(null);

  const proxiedVideoUrl = videoUrl ? `/api/proxy-video?url=${encodeURIComponent(videoUrl)}` : null;

  const togglePlay = async () => {
    if (!videoRef.current || !proxiedVideoUrl) return;
    
    if (isPlaying) {
      try {
        if (playPromiseRef.current) {
          try { await playPromiseRef.current; } catch (e) {}
        }
        videoRef.current.pause();
        setIsPlaying(false);
      } catch (err) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    } else {
      try {
        const promise = videoRef.current.play();
        playPromiseRef.current = promise;
        setIsPlaying(true);
        await promise;
        playPromiseRef.current = null;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error("Video playback failed:", err.message || "Unknown error");
        }
        setIsPlaying(false);
        playPromiseRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (videoRef.current && proxiedVideoUrl) {
      videoRef.current.load();
    }
  }, [proxiedVideoUrl]);

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = "";
        try { videoRef.current.load(); } catch (e) {}
      }
    };
  }, []);

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!videoUrl || isDownloading) return;
    setIsDownloading(true);
    try {
      const downloadUrl = `/api/proxy-video?url=${encodeURIComponent(videoUrl)}&download=true`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.target = '_blank';
      link.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setIsDownloading(false);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      className="group relative w-full bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-xl my-4"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Aspect Ratio Container */}
      <div className="aspect-video relative bg-black">
        <video
          key={proxiedVideoUrl || 'no-video'}
          ref={videoRef}
          src={proxiedVideoUrl || undefined}
          crossOrigin="anonymous"
          poster={thumbnail || undefined}
          className="w-full h-full object-contain"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onWaiting={() => console.log("Video buffering...")}
          onError={(e) => {
            const target = e.target as HTMLVideoElement;
            console.error("Video element error:", target.error?.message, "Code:", target.error?.code);
            if (target.error?.code === 4) {
              alert("Impossible de lire cette vidéo (Erreur de format ou lien expiré). Les vidéos d'Internet Archive peuvent parfois être indisponibles temporairement.");
            }
          }}
          playsInline
        />

        {/* Overlay Controls */}
        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-300 ${isPlaying && !isHovering ? 'opacity-0' : 'opacity-100'}`}>
          <button
            onClick={togglePlay}
            className="w-16 h-16 rounded-full bg-orange-500/90 hover:bg-orange-500 flex items-center justify-center text-white transition-transform active:scale-90 shadow-2xl"
          >
            {isPlaying ? <Pause className="w-8 h-8 fill-white" /> : <Play className="w-8 h-8 fill-white ml-1" />}
          </button>
        </div>

        {/* Duration Badge */}
        {duration && (
          <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/70 text-white text-[10px] font-bold rounded-md backdrop-blur-sm border border-white/10">
            {formatDuration(duration)}
          </div>
        )}

        {/* Source Badge */}
        {source && (
          <div className="absolute top-3 left-3 px-2 py-1 bg-orange-500/90 text-white text-[10px] font-bold rounded-md shadow-lg uppercase tracking-wider">
            {source}
          </div>
        )}
      </div>

      {/* Info & Actions */}
      <div className="p-4 bg-zinc-900/50 backdrop-blur-md flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500 shrink-0 border border-zinc-700">
            <Video className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-zinc-100 truncate pr-2">
              {title}
            </h4>
            <p className="text-[11px] text-zinc-500 font-medium">
              Royalty-free Video • {source || 'Web'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className={`p-2 rounded-xl transition-colors ${isDownloading ? 'text-orange-500 bg-orange-500/10' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
            title={isDownloading ? "Téléchargement..." : "Télécharger la vidéo"}
          >
            <Download className={`w-4 h-4 ${isDownloading ? 'animate-spin' : ''}`} />
          </button>
          <a
            href={downloadUrl || videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-xl transition-colors"
            title="Ouvrir dans un nouvel onglet"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
