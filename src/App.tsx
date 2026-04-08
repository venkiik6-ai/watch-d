/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Watch, 
  Upload, 
  History, 
  Battery, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Camera,
  Trash2,
  ChevronRight,
  Info,
  Search,
  Database,
  Cloud
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { identifyWatch, getBatteryInfo, WatchResult } from "@/src/lib/gemini";

interface HistoryItem extends WatchResult {
  id: string;
  timestamp: number;
  image: string;
}

type WorkflowStep = "upload" | "confirm" | "result";

export default function App() {
  const [image, setImage] = useState<string | null>(null);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [step, setStep] = useState<WorkflowStep>("upload");
  const [dbConfigured, setDbConfigured] = useState<boolean | null>(null);
  
  const [identification, setIdentification] = useState<Partial<WatchResult> | null>(null);
  const [finalResult, setFinalResult] = useState<WatchResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    checkDbStatus();
    fetchHistory();
  }, []);

  const checkDbStatus = async () => {
    try {
      const res = await fetch("/api/db-status");
      if (res.ok) {
        const data = await res.json();
        setDbConfigured(data.configured);
      }
    } catch (e) {
      setDbConfigured(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/history");
      if (res.ok) {
        const data = await res.json();
        const mappedData = data.map((item: any) => ({
          ...item,
          image: item.image_data,
          timestamp: new Date(item.created_at).getTime()
        }));
        setHistory(mappedData);
      }
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setStep("upload");
        setIdentification(null);
        setFinalResult(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleIdentify = async () => {
    if (!image) return;
    setIsIdentifying(true);
    try {
      const res = await identifyWatch(image);
      
      if (res.is_watch === false) {
        toast.error("No watch detected. Please upload a clear image of a wrist watch.");
        setImage(null);
        return;
      }

      setIdentification(res);
      setStep("confirm");
      toast.success("Watch identified! Please confirm the model.");
    } catch (error) {
      console.error(error);
      toast.error("Identification failed");
    } finally {
      setIsIdentifying(false);
    }
  };

  const handleConfirm = async () => {
    if (!identification || !image) return;
    setIsLookingUp(true);
    try {
      // 1. Check Cache
      let batteryData = null;
      try {
        const cacheRes = await fetch(`/api/cache/${encodeURIComponent(identification.normalized_name!)}`);
        if (cacheRes.ok) {
          batteryData = await cacheRes.json();
          toast.info("Retrieved from database cache");
        }
      } catch (e) {
        console.warn("Cache lookup skipped: DB not available");
      }
      
      if (!batteryData) {
        // 2. Lookup via Gemini if not in cache or cache failed
        toast.info("Querying AI for battery specs...");
        batteryData = await getBatteryInfo(identification.brand!, identification.model!);
        
        // 3. Store in Cache (Try-catch to ignore if DB is down)
        try {
          await fetch("/api/cache", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...identification,
              ...batteryData
            })
          });
        } catch (e) {
          console.warn("Caching failed: DB not available");
        }
      }

      const fullResult: WatchResult = {
        ...identification as any,
        ...batteryData
      };

      setFinalResult(fullResult);
      setStep("result");

      // 4. Save to History (Try-catch to ignore if DB is down)
      try {
        await fetch("/api/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fullResult, image })
        });
        fetchHistory();
      } catch (e) {
        console.warn("History save failed: DB not available");
      }
      
      toast.success("Battery specifications retrieved!");
    } catch (error) {
      console.error(error);
      toast.error("Battery lookup failed");
    } finally {
      setIsLookingUp(false);
    }
  };

  const clearHistory = async () => {
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      if (res.ok) {
        setHistory([]);
        toast.info("History cleared");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleNewScan = () => {
    setImage(null);
    setIdentification(null);
    setFinalResult(null);
    setStep("upload");
  };

  return (
    <div className="min-h-screen technical-grid">
      <Toaster position="top-center" />
      
      {dbConfigured === false && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 p-2 text-center">
          <p className="text-[10px] font-mono text-amber-500 uppercase tracking-widest flex items-center justify-center gap-2">
            <AlertCircle className="w-3 h-3" />
            Database not configured. Persistence and caching are disabled. Set DATABASE_URL in Secrets.
          </p>
        </div>
      )}
      
      <header className="relative pt-16 pb-8 px-6 overflow-hidden">
        <div className="max-w-7xl mx-auto relative z-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-watch-gold/10 rounded-lg border border-watch-gold/20">
                <Watch className="w-5 h-5 text-watch-gold" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-500">Cloud-Native Horology Engine</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tighter leading-none mb-4">
              WATCH<span className="text-watch-gold">'D</span>
            </h1>
          </motion.div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-7 space-y-8">
          
          {/* Workflow Visualization */}
          <div className="flex items-center justify-between px-4 py-2 bg-white/5 rounded-full border border-white/10 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            <div className={`flex items-center gap-2 ${step === 'upload' ? 'text-watch-gold' : ''}`}>
              <Cloud className="w-3 h-3" /> VISION
            </div>
            <ChevronRight className="w-3 h-3 opacity-20" />
            <div className={`flex items-center gap-2 ${step === 'confirm' ? 'text-watch-gold' : ''}`}>
              <CheckCircle2 className="w-3 h-3" /> CONFIRM
            </div>
            <ChevronRight className="w-3 h-3 opacity-20" />
            <div className={`flex items-center gap-2 ${step === 'result' ? 'text-watch-gold' : ''}`}>
              <Database className="w-3 h-3" /> CACHE & SPECS
            </div>
          </div>

          <Card className="glass-card overflow-hidden">
            <CardContent className="p-0">
              <div className="aspect-video relative group bg-zinc-900/50">
                {image ? (
                  <img src={image} alt="Preview" className="w-full h-full object-contain" />
                ) : (
                  <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-white/5 transition-colors border-2 border-dashed border-white/10 m-4 rounded-xl">
                    <Upload className="w-10 h-10 text-zinc-600 mb-4" />
                    <p className="text-xs font-mono uppercase tracking-widest text-zinc-500">Upload Watch Image</p>
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                  </label>
                )}
              </div>
            </CardContent>
            
            <div className="p-6 bg-white/5 border-t border-white/10">
              <AnimatePresence mode="wait">
                {step === "upload" && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase">Step 1: Visual Identification</span>
                    <Button disabled={!image || isIdentifying} onClick={handleIdentify} className="bg-watch-gold text-black font-bold">
                      {isIdentifying ? <Loader2 className="animate-spin mr-2" /> : <Camera className="mr-2 w-4 h-4" />}
                      IDENTIFY MODEL
                    </Button>
                  </motion.div>
                )}

                {step === "confirm" && identification && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-xl font-display font-bold text-zinc-900 dark:text-white">{identification.brand}</h3>
                        <p className="text-sm font-mono text-watch-gold font-medium">{identification.model}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] font-mono border-zinc-200 dark:border-white/20 text-zinc-500 dark:text-zinc-400">{identification.confidence} CONFIDENCE</Badge>
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline" onClick={() => setStep("upload")} className="flex-1">RETRY</Button>
                      <Button disabled={isLookingUp} onClick={handleConfirm} className="flex-1 bg-watch-gold text-black font-bold">
                        {isLookingUp ? <Loader2 className="animate-spin mr-2" /> : <Search className="mr-2 w-4 h-4" />}
                        CONFIRM & GET SPECS
                      </Button>
                    </div>
                  </motion.div>
                )}

                {step === "result" && finalResult && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                    <div className="flex justify-between items-start border-b border-white/5 pb-4">
                      <div>
                        <h3 className="text-xl font-display font-bold text-zinc-900 dark:text-white">{finalResult.brand}</h3>
                        <p className="text-sm font-mono text-watch-gold">{finalResult.model}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] font-mono opacity-50">ARCHIVED RESULT</Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-zinc-900/80 rounded-xl border border-watch-gold/30 shadow-[0_0_20px_rgba(212,175,55,0.1)]">
                        <p className="text-[10px] font-mono text-watch-gold uppercase mb-2 tracking-widest">Battery Type</p>
                        <p className="text-2xl font-display font-bold flex items-center gap-3 text-white">
                          <Battery className="w-5 h-5 text-watch-gold" />
                          {finalResult.battery}
                        </p>
                      </div>
                      <div className="p-4 bg-zinc-900/80 rounded-xl border border-watch-gold/30 shadow-[0_0_20px_rgba(212,175,55,0.1)]">
                        <p className="text-[10px] font-mono text-watch-gold uppercase mb-2 tracking-widest">Quantity</p>
                        <p className="text-2xl font-display font-bold flex items-center gap-3 text-white">
                          <CheckCircle2 className="w-5 h-5 text-watch-gold" />
                          {finalResult.quantity}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="text-[10px] font-mono text-watch-gold uppercase tracking-widest font-bold">Physical Specs</p>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3 bg-zinc-100 dark:bg-white/5 rounded-lg border border-zinc-200 dark:border-white/10 text-center">
                          <p className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase mb-1">Lug Width</p>
                          <p className="text-sm font-bold text-zinc-900 dark:text-white">{finalResult.strap_size || 'N/A'}</p>
                        </div>
                        <div className="p-3 bg-zinc-100 dark:bg-white/5 rounded-lg border border-zinc-200 dark:border-white/10 text-center">
                          <p className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase mb-1">Case Size</p>
                          <p className="text-sm font-bold text-zinc-900 dark:text-white">{finalResult.dial_size || 'N/A'}</p>
                        </div>
                        <div className="p-3 bg-zinc-100 dark:bg-white/5 rounded-lg border border-zinc-200 dark:border-white/10 text-center">
                          <p className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase mb-1">Material</p>
                          <p className="text-[10px] font-bold text-zinc-900 dark:text-white truncate px-1">{finalResult.strap_material || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {finalResult.functions && finalResult.functions.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-mono text-watch-gold uppercase tracking-widest font-bold">Watch Functions</p>
                        <div className="flex flex-wrap gap-2">
                          {finalResult.functions.map((func, i) => (
                            <Badge key={i} variant="secondary" className="bg-watch-gold/20 text-watch-gold border-watch-gold/40 text-[10px] font-mono font-bold">
                              {func}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {finalResult.speciality && (
                      <div className="p-4 bg-watch-gold/5 border border-watch-gold/30 rounded-xl">
                        <p className="text-[10px] font-mono text-watch-gold uppercase tracking-widest mb-2 flex items-center gap-2 font-bold">
                          <Info className="w-3 h-3" /> Speciality
                        </p>
                        <p className="text-sm text-zinc-900 dark:text-zinc-100 italic leading-relaxed font-medium">
                          "{finalResult.speciality}"
                        </p>
                      </div>
                    )}

                    {(finalResult.estimated_price || finalResult.estimated_price_inr) && (
                      <div className="p-4 bg-zinc-900/80 rounded-xl border border-watch-gold/30 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-mono text-watch-gold uppercase tracking-widest">Est. Battery Price</p>
                          <div className="flex items-baseline gap-2">
                            <p className="text-xl font-bold text-white">{finalResult.estimated_price_inr || finalResult.estimated_price}</p>
                            {finalResult.estimated_price_inr && finalResult.estimated_price && (
                              <p className="text-sm font-mono text-zinc-400">({finalResult.estimated_price})</p>
                            )}
                          </div>
                        </div>
                        {finalResult.purchase_link && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="border-watch-gold/40 text-watch-gold hover:bg-watch-gold/10"
                            onClick={() => window.open(finalResult.purchase_link, '_blank')}
                          >
                            BUY NOW
                          </Button>
                        )}
                      </div>
                    )}

                    <Button variant="outline" className="w-full border-watch-gold/20 hover:bg-watch-gold/10 text-watch-gold font-mono tracking-widest" onClick={handleNewScan}>NEW SCAN</Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <Card className="glass-card h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-display font-bold flex items-center gap-2">
                  <History className="w-4 h-4 text-watch-gold" />
                  HISTORY
                </CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={clearHistory} className="text-zinc-600 hover:text-red-400">
                <Trash2 className="w-4 h-4" />
              </Button>
            </CardHeader>
            <Separator className="bg-white/5" />
            <ScrollArea className="flex-1 p-4">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 opacity-20">
                  <Watch className="w-12 h-12" />
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map((item) => (
                    <div key={item.id} className="flex items-center gap-4 p-2 rounded hover:bg-white/5 transition-colors cursor-pointer" onClick={() => {
                      setFinalResult(item);
                      setImage(item.image);
                      setStep("result");
                    }}>
                      <img src={item.image} className="w-12 h-12 object-cover rounded border border-white/10" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate text-zinc-900 dark:text-white">{item.brand}</p>
                        <p className="text-[10px] font-mono text-watch-gold truncate font-medium">{item.model}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-800" />
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </Card>
        </div>
      </main>
    </div>
  );
}


