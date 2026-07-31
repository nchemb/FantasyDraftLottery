/** Replay on a phone: the end screen paused the bed and iOS suspended the
    AudioContext. Replay must resume it and re-unlock the announcer element. */
const fs=require('fs'); const {JSDOM}=require('jsdom');
const R="/Users/neej/Documents/Projects/FantasyDraftLottery";
const HTML=fs.readFileSync(R+"/reveal.html","utf8"), JS=fs.readFileSync(R+"/reveal.js","utf8");
const justNow=new Date(Date.now()-300).toISOString();
const LIVE={leagueName:"L",teamCount:5,revealId:"x",teams:["a","b","c","d","e"],weighted:true,
 sealedAt:justNow,commitmentHash:"h",mode:"scheduled",scheduledAt:justNow,showStartedAt:justNow,
 serverNow:new Date().toISOString(),pickGapSeconds:0,live:true,draftOrder:["a","b","c","d","e"],
 audioManifest:{intro:"https://cdn/i.mp3",twoRemain:"https://cdn/t.mp3",
  picks:{1:"https://cdn/1.mp3",2:"https://cdn/2.mp3",3:"https://cdn/3.mp3",4:"https://cdn/4.mp3",5:"https://cdn/5.mp3"},
  dur:{intro:15337,twoRemain:5906,picks:{1:8702,2:6220,3:8702,4:8231,5:7030}}}};

const dom=new JSDOM(HTML,{runScripts:"outside-only",url:"https://x/reveal.html?id=x"});
const w=dom.window;
const plays=[];
// iOS model: volume writes ignored; context suspends whenever media pauses.
w.HTMLMediaElement.prototype.play=function(){plays.push({id:this.id,src:(this.src||"").slice(0,26)});this.__p=false;return Promise.resolve();};
// Only the bed is routed through the context, and iOS suspends on audio-session
// interruption -- pausing an unrelated element does not suspend it.
w.HTMLMediaElement.prototype.pause=function(){this.__p=true; if(ctx && this.id==="bedMusic") ctx.state="suspended";};
w.HTMLMediaElement.prototype.load=function(){};
Object.defineProperty(w.HTMLMediaElement.prototype,'volume',{set(){/*iOS ignores*/},get(){return 1;},configurable:true});
Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{get(){return this.__p!==false;},configurable:true});
w.HTMLElement.prototype.scrollIntoView=()=>{}; w.confetti=()=>{};
let ctx=null; const gains=[];
w.AudioContext=function(){ ctx=this; this.state="suspended"; this.currentTime=0;
  this.resume=()=>{this.state="running";return Promise.resolve();};
  this.createMediaElementSource=()=>({connect(){}});
  this.createGain=()=>({gain:{setTargetAtTime:(v)=>gains.push(+v.toFixed(2))},connect(){}});
};
w.fetch=(u)=>Promise.resolve({ok:true,json:()=>Promise.resolve(String(u).includes("reveal-state")
  ?{mode:"scheduled",showStartedAt:justNow,serverNow:new Date().toISOString()}:LIVE)});
w.eval(JS); w.document.dispatchEvent(new w.Event("DOMContentLoaded"));

setTimeout(()=>{
  w.document.getElementById("joinBtn").click();
  setTimeout(()=>{
    // simulate the show ending -> bed pauses -> iOS suspends the context
    w.document.getElementById("bedMusic").pause();
    ctx.state="suspended";
    plays.length=0; gains.length=0;
    w.document.getElementById("replayBtn").click();
    setTimeout(()=>{
      const res=[
        ["replay resumes the AudioContext", ctx.state==="running", "state="+ctx.state],
        ["replay restarts the bed", plays.some(p=>p.id==="bedMusic"), plays.map(p=>p.id).join(",")],
        ["replay re-unlocks the announcer element", plays.some(p=>p.id==="voPlayer"&&p.src.startsWith("data:audio")), plays.filter(p=>p.id==="voPlayer").map(p=>p.src).join("|")||"none"],
        ["replay sets a mixed bed level", gains.includes(0.28), "gains="+gains.join(">")],
        ["end screen hidden", w.document.getElementById("endScreen").classList.contains("hidden"), ""],
      ];
      let p=0; console.log();
      for(const [n,ok,d] of res){console.log(`${ok?"PASS":"FAIL"}  ${n}\n        ${d}`); if(ok)p++;}
      console.log(`\n${p}/${res.length} passed`);
      process.exit(p===res.length?0:1);
    },250);
  },300);
},150);
