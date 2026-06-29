import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Music, Volume2, VolumeX, ExternalLink, Download } from 'lucide-react';

interface MusicPlayerProps {
  title: string;
  artist: string;
  cover?: string | null;
  duration: number;
  audioUrl?: string | null;
}

export default function MusicPlayer({ title, artist, cover, duration: propDuration, audioUrl }: MusicPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(propDuration || 0);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(1);
  const [volume, setVolume] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const isValidUrl = audioUrl && 
    audioUrl.startsWith('http') && 
    audioUrl.length > 15 && 
    (audioUrl.includes('.mp3') || audioUrl.includes('.m4a') || audioUrl.includes('jamendo') || audioUrl.includes('apple') || audioUrl.includes('itunes'));
  
  const proxiedAudioUrl = isValidUrl ? `/api/proxy-audio?url=${encodeURIComponent(audioUrl)}` : null;

  useEffect(() => {
    const handleUrlChange = async () => {
      if (playPromiseRef.current) {
        try { await playPromiseRef.current; } catch (e) {}
      }
      if (isMountedRef.current) {
        setIsPlaying(false);
        setCurrentTime(0);
      }
    };
    handleUrlChange();
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      // Handled by isMountedRef and separate useEffect cleanup
    };
  }, []);

  const playPromiseRef = useRef<Promise<void> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      const cleanup = async () => {
        isMountedRef.current = false;
        if (playPromiseRef.current) {
          try { await playPromiseRef.current; } catch (e) {}
        }
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = "";
          audioRef.current.load();
        }
      };
      cleanup();
    };
  }, []);

  const togglePlay = async () => {
    if (!audioRef.current || !proxiedAudioUrl) return;

    if (isPlaying) {
      try {
        if (playPromiseRef.current) {
          try { await playPromiseRef.current; } catch (e) {}
        }
        if (isMountedRef.current && audioRef.current) {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      } catch (err) {
        if (isMountedRef.current && audioRef.current) {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      }
    } else {
      // Trigger custom events to let other MusicPlayer components know to pause
      const playEvent = new CustomEvent('cephboy-audio-play', { detail: { ref: audioRef.current } });
      document.dispatchEvent(playEvent);

      try {
        setIsBuffering(true);
        const promise = audioRef.current.play();
        playPromiseRef.current = promise;
        setIsPlaying(true);
        
        await promise;
        playPromiseRef.current = null;
        if (isMountedRef.current) {
          setIsBuffering(false);
        }
      } catch (err: any) {
        if (isMountedRef.current) {
          if (err.name !== 'AbortError') {
            console.error("Audio playback failed:", err.message || err);
          }
          setIsPlaying(false);
          setIsBuffering(false);
        }
        playPromiseRef.current = null;
      }
    }
  };

  useEffect(() => {
    const handleOtherPlay = async (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.ref !== audioRef.current && isPlaying) {
        try {
          if (playPromiseRef.current) {
            await playPromiseRef.current;
          }
          if (isMountedRef.current) {
            audioRef.current?.pause();
            setIsPlaying(false);
          }
        } catch (err) {
          if (isMountedRef.current) {
            audioRef.current?.pause();
            setIsPlaying(false);
          }
        }
      }
    };

    document.addEventListener('cephboy-audio-play', handleOtherPlay);
    return () => {
      document.removeEventListener('cephboy-audio-play', handleOtherPlay);
    };
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    if (audioRef.current.duration) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !audioRef.current || !duration) return;
    
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = Math.max(0, Math.min(1, clickX / width));
    
    audioRef.current.currentTime = percentage * duration;
    setCurrentTime(percentage * duration);
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = previousVolume;
      setVolume(previousVolume);
      setIsMuted(false);
    } else {
      setPreviousVolume(volume);
      audioRef.current.volume = 0;
      setVolume(0);
      setIsMuted(true);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!audioUrl || isDownloading) return;
    
    setIsDownloading(true);
    try {
      const proxiedUrl = `/api/proxy-audio?url=${encodeURIComponent(audioUrl)}`;
      const response = await fetch(proxiedUrl);
      if (!response.ok) throw new Error("Download failed");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Clean the filename to remove unsafe characters
      const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, "_");
      a.download = `${safeTitle}.mp3`;
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);
    } catch (err) {
      console.error("Download failed via proxy fetch:", err);
      // Last resort fallback: direct link with download attribute
      const downloadUrl = `/api/proxy-audio?url=${encodeURIComponent(audioUrl)}&download=true&filename=${encodeURIComponent(title)}`;
      window.open(downloadUrl, '_blank');
    } finally {
      setIsDownloading(false);
    }
  };

  const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds) || timeInSeconds === Infinity) return "0:00";
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800/80 backdrop-blur-md rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center w-full max-w-xl shadow-lg transition hover:border-zinc-700/80 my-3 select-none">
      {/* Audio element */}
      <audio
        key={proxiedAudioUrl || 'no-audio'}
        ref={audioRef}
        src={proxiedAudioUrl || undefined}
        crossOrigin="anonymous"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onError={(e) => {
          const target = e.target as HTMLAudioElement;
          console.error("Audio playback error:", target.error?.message, "Code:", target.error?.code);
          setIsPlaying(false);
          setIsBuffering(false);
          if (target.error?.code === 4) {
            alert("Erreur de format ou lien expiré (404). Notez que les morceaux iTunes sont des extraits temporaires qui peuvent expirer rapidement. Essayez une autre recherche.");
          }
        }}
        preload="auto"
      />

      {/* Cover / Icon */}
      <div className="flex-shrink-0 relative group">
        {cover ? (
          <img
            src={cover || null}
            alt={title}
            className="w-16 h-16 rounded-xl object-cover bg-zinc-950 border border-zinc-800 shadow-md transition-transform group-hover:scale-105"
            onError={(e) => {
              // fallback if cover fails to load
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-orange-500/10 to-orange-500/20 border border-orange-500/20 flex items-center justify-center text-orange-400 shadow-md">
            <Music className="w-6 h-6 animate-pulse" />
          </div>
        )}
      </div>

      {/* Control Details & Track Info */}
      <div className="flex-1 min-w-0 w-full flex flex-col justify-center">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-zinc-100 truncate leading-snug">{title}</h4>
            <p className="text-xs text-zinc-400 truncate mt-0.5">{artist}</p>
          </div>
          
          {/* Audio platform identifier */}
          <span 
            className={`text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md border flex items-center gap-1 ${
              duration > 40 
                ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" 
                : "text-amber-500 bg-amber-500/10 border-amber-500/20"
            }`}
            title={duration > 40 ? "Morceau complet" : "Extrait de 30 secondes"}
          >
            {duration > 40 ? "Full" : "Preview"}
          </span>
        </div>

        {/* Progress bar and time indicators */}
        <div className="flex items-center gap-2.5 mt-2 w-full">
          <span className="text-[10px] font-mono text-zinc-400 w-8 text-right shrink-0">{formatTime(currentTime)}</span>
          
          <div
            ref={progressBarRef}
            onClick={handleProgressClick}
            className="relative flex-1 h-1.5 bg-zinc-800/80 rounded-full cursor-pointer hover:h-2 transition-all duration-200"
          >
            <div
              className="absolute left-0 top-0 h-full bg-orange-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-md scale-0 group-hover:scale-100 transition-transform duration-100" />
            </div>
          </div>
          
          <span className="text-[10px] font-mono text-zinc-400 w-8 shrink-0">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleDownload}
          disabled={!audioUrl || isDownloading}
          className="flex items-center gap-1.5 px-2 py-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title={isDownloading ? "Téléchargement..." : "Télécharger la chanson"}
        >
          <Download className={`w-4 h-4 ${isDownloading ? "animate-spin text-orange-500" : ""}`} />
          <span className="text-xs font-medium">Télécharger</span>
        </button>

        <button
          onClick={toggleMute}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 rounded-lg transition cursor-pointer hidden sm:block"
          title={isMuted ? "Réactiver le son" : "Couper le son"}
        >
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <div className="flex items-center gap-1 bg-zinc-800/30 rounded-full p-1 border border-zinc-700/30">
          <button className="p-1.5 text-zinc-500 hover:text-zinc-300 transition cursor-not-allowed opacity-50" title="Précédent">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>

          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-orange-500 hover:bg-orange-600 active:scale-95 flex items-center justify-center text-white transition shadow-md hover:shadow-orange-500/25 hover:shadow-lg cursor-pointer disabled:opacity-70"
            title={isPlaying ? "Pause" : "Lire"}
            disabled={isBuffering}
          >
            {isBuffering ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5 fill-white" />
            ) : (
              <Play className="w-5 h-5 fill-white ml-0.5" />
            )}
          </button>

          <button className="p-1.5 text-zinc-500 hover:text-zinc-300 transition cursor-not-allowed opacity-50" title="Suivant">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6zm9-12h2v12h-2z"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
