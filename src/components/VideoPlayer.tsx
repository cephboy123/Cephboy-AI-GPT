import { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, Maximize2, SkipBack, SkipForward, Clock, Volume2, VolumeX } from 'lucide-react';

interface VideoPlayerProps {
  frames: string[];
  prompt: string;
}

export default function VideoPlayer({ frames, prompt }: VideoPlayerProps) {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(800); // ms per frame
  const [isMuted, setIsMuted] = useState(true); // muted by default to respect autoplay policies
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Audio Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const droneOscRef = useRef<OscillatorNode | null>(null);
  const chimeOscRef = useRef<OscillatorNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentFrame((prev) => (prev + 1) % frames.length);
      }, speed);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, speed, frames.length]);

  // Lazy initialize cinematic synthesizer
  const initAudio = () => {
    if (audioCtxRef.current) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      // Master Gain for smooth volume transitions
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0, ctx.currentTime);
      masterGain.connect(ctx.destination);
      gainNodeRef.current = masterGain;

      // Lowpass Filter for a deep, cinematic warm tone
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(180, ctx.currentTime);
      filter.Q.setValueAtTime(1, ctx.currentTime);
      filter.connect(masterGain);
      filterNodeRef.current = filter;

      // 1. Deep Bass Drone (Triangle wave) playing a low A (55Hz)
      const drone = ctx.createOscillator();
      drone.type = 'triangle';
      drone.frequency.setValueAtTime(55, ctx.currentTime); 
      drone.connect(filter);
      drone.start();
      droneOscRef.current = drone;

      // 2. Soft Ambient Harmonic (Sine wave) playing A2 (110Hz)
      const harmony = ctx.createOscillator();
      harmony.type = 'sine';
      harmony.frequency.setValueAtTime(110, ctx.currentTime); 
      
      const harmonyGain = ctx.createGain();
      harmonyGain.gain.setValueAtTime(0.3, ctx.currentTime);
      harmony.connect(harmonyGain);
      harmonyGain.connect(filter);
      
      harmony.start();
      chimeOscRef.current = harmony;
    } catch (e) {
      console.error("Failed to initialize Web Audio API synthesizer:", e);
    }
  };

  // Manage audio play and pause states
  useEffect(() => {
    if (isPlaying && !isMuted) {
      initAudio();
      if (audioCtxRef.current) {
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume();
        }
        const ctx = audioCtxRef.current;
        gainNodeRef.current?.gain.cancelScheduledValues(ctx.currentTime);
        gainNodeRef.current?.gain.setValueAtTime(gainNodeRef.current.gain.value, ctx.currentTime);
        gainNodeRef.current?.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.5); // Smooth fade-in
      }
    } else {
      if (audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        gainNodeRef.current?.gain.cancelScheduledValues(ctx.currentTime);
        gainNodeRef.current?.gain.setValueAtTime(gainNodeRef.current.gain.value, ctx.currentTime);
        gainNodeRef.current?.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3); // Smooth fade-out
      }
    }
  }, [isPlaying, isMuted]);

  // Adapt harmonies and sound cutoff frequency based on the current scene frame
  useEffect(() => {
    if (!audioCtxRef.current || isMuted || !isPlaying) return;

    const ctx = audioCtxRef.current;
    
    // Harmonic scale steps (A, C#, E, A) to create an evolving sci-fi space cinematic atmosphere
    const frequencies = [110, 137.5, 165, 220]; 
    const filterCutoffs = [180, 240, 300, 210]; 

    if (chimeOscRef.current) {
      chimeOscRef.current.frequency.cancelScheduledValues(ctx.currentTime);
      chimeOscRef.current.frequency.setValueAtTime(chimeOscRef.current.frequency.value, ctx.currentTime);
      chimeOscRef.current.frequency.exponentialRampToValueAtTime(frequencies[currentFrame % frequencies.length], ctx.currentTime + 0.6);
    }
    
    if (filterNodeRef.current) {
      filterNodeRef.current.frequency.cancelScheduledValues(ctx.currentTime);
      filterNodeRef.current.frequency.setValueAtTime(filterNodeRef.current.frequency.value, ctx.currentTime);
      filterNodeRef.current.frequency.linearRampToValueAtTime(filterCutoffs[currentFrame % filterCutoffs.length], ctx.currentTime + 0.8);
    }
  }, [currentFrame, isMuted, isPlaying]);

  // Clean up audio nodes on component unmount
  useEffect(() => {
    return () => {
      if (droneOscRef.current) {
        try { droneOscRef.current.stop(); } catch (e) {}
      }
      if (chimeOscRef.current) {
        try { chimeOscRef.current.stop(); } catch (e) {}
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch (e) {}
      }
    };
  }, []);

  const handleNext = () => {
    setIsPlaying(false);
    setCurrentFrame((prev) => (prev + 1) % frames.length);
  };

  const handlePrev = () => {
    setIsPlaying(false);
    setCurrentFrame((prev) => (prev - 1 + frames.length) % frames.length);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentFrame(0);
  };

  const downloadFrame = () => {
    const url = frames[currentFrame];
    if (!url) return;
    const link = document.createElement('a');
    link.href = `/api/download-image?url=${encodeURIComponent(url)}`;
    link.download = `cephboy_video_frame_${currentFrame + 1}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFullScreen = () => {
    const element = document.getElementById(`video-container-${prompt.slice(0, 10)}`);
    if (element) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        element.requestFullscreen().catch((err) => {
          console.error("Fullscreen error", err);
        });
      }
    }
  };

  return (
    <div 
      id={`video-container-${prompt.slice(0, 10)}`}
      className="mt-4 relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 max-w-xl shadow-lg flex flex-col group font-sans"
    >
      {/* Video Display Stage */}
      <div className="relative aspect-video w-full overflow-hidden flex items-center justify-center bg-black">
        {frames.map((frame, index) => (
          <img
            key={index}
            src={frame}
            alt={`Frame ${index + 1}`}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out ${
              index === currentFrame ? 'opacity-100 scale-100 z-10' : 'opacity-0 scale-98 z-0'
            }`}
            referrerPolicy="no-referrer"
          />
        ))}

        {/* Storyboard Prompt Overlay */}
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-[10px] text-white/90 z-20 pointer-events-none uppercase tracking-wider font-bold">
          Plan {currentFrame + 1} / {frames.length}
        </div>

        {/* Big Play / Pause Overlay on hover */}
        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-25 pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md border border-white/40 flex items-center justify-center text-white shadow-lg pointer-events-auto cursor-pointer active:scale-95 transition-all" onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? <Pause className="w-6 h-6 fill-white" /> : <Play className="w-6 h-6 fill-white ml-0.5" />}
          </div>
        </div>
      </div>

      {/* Progressive timeline bar */}
      <div className="w-full h-1 bg-slate-800 relative z-30 cursor-pointer">
        <div 
          className="h-full bg-orange-500 transition-all duration-300" 
          style={{ width: `${((currentFrame + 1) / frames.length) * 100}%` }}
        />
      </div>

      {/* Player Interface Controls */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 text-white flex flex-col gap-3 relative z-30">
        <div className="flex items-center justify-between">
          {/* Timeline dots / frames picker */}
          <div className="flex items-center gap-1.5">
            {frames.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setIsPlaying(false);
                  setCurrentFrame(index);
                }}
                className={`w-2.5 h-2.5 rounded-full transition-all cursor-pointer ${
                  index === currentFrame 
                    ? 'bg-orange-500 scale-125' 
                    : 'bg-slate-600 hover:bg-slate-400'
                }`}
                title={`Sauter au plan ${index + 1}`}
              />
            ))}
          </div>

          {/* Speed Selector */}
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <div className="flex gap-1">
              {[1200, 800, 400].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`px-2 py-0.5 rounded transition cursor-pointer ${
                    speed === s 
                      ? 'bg-orange-600 text-white' 
                      : 'hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {s === 1200 ? 'Lent' : s === 800 ? '1x' : 'Rapide'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
          {/* Main playback control buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrev}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              title="Plan précédent"
            >
              <SkipBack className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-2.5 bg-orange-600 hover:bg-orange-500 rounded-xl text-white transition cursor-pointer shadow-md shadow-orange-600/10 active:scale-95"
              title={isPlaying ? "Mettre en pause" : "Lancer la lecture"}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
            </button>
            <button
              onClick={handleNext}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              title="Plan suivant"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
            <button
              onClick={handleReset}
              className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
              title="Recommencer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (isMuted) {
                  initAudio();
                }
                setIsMuted(!isMuted);
              }}
              className={`p-2 rounded-lg transition cursor-pointer flex items-center gap-1.5 px-2.5 text-xs font-semibold ${
                !isMuted 
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' 
                  : 'bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-white border border-slate-700'
              }`}
              title={isMuted ? "Activer la bande-son cinématique" : "Couper la bande-son"}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-orange-500" /> : <Volume2 className="w-4 h-4 text-orange-400 animate-pulse" />}
              <span className="hidden sm:inline">Son {isMuted ? "Off" : "On"}</span>
            </button>
          </div>

          {/* Download & Fullscreen controls */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={downloadFrame}
              className="p-2 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-lg transition flex items-center gap-1.5 px-3 text-xs font-bold cursor-pointer"
              title="Télécharger l'image de ce plan"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Image</span>
            </button>
            <button
              onClick={handleFullScreen}
              className="p-2 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white rounded-lg transition cursor-pointer"
              title="Plein écran"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
