// ── LOGIN ──────────────────────────
document.getElementById('lbtn').onclick=async function(){
  var em=document.getElementById('lemail').value.trim();
  var pw=document.getElementById('lpw').value.trim();
  var err=document.getElementById('lerr');
  if(!em||!pw){err.textContent='Enter email and password.';return;}
  err.textContent='';this.textContent='Signing in...';this.disabled=true;
  var slowTimer=setTimeout(function(){err.style.color='#7c6af7';err.textContent='Starting up server... please wait 30 seconds ☕';},5000);
  // Node.js backend: POST /api/auth/login
  var r=await api('/auth/login','POST',{email:em,password:pw});
  clearTimeout(slowTimer);err.style.color='#e24b4a';this.textContent='Sign In';this.disabled=false;
  if(r.ok){
    token=r.data.token;
    user=r.data.user;
    // Node.js returns user.full_name
    if(user&&!user.full_name&&user.name)user.full_name=user.name;
    if(user&&!user.name&&user.full_name)user.name=user.full_name;
    localStorage.setItem('wm_token',token);
    localStorage.setItem('wm_user',JSON.stringify(user));
    enterApp();
  }else{
    // Node.js returns r.data.message
    err.textContent=r.data.message||'Login failed.';
  }
};

// ── SIGNUP ──────────────────────────
document.getElementById('sbtn').onclick=async function(){
  var name=document.getElementById('sname').value.trim();
  var em=document.getElementById('semail').value.trim();
  var pw=document.getElementById('spw').value.trim();
  var loc=document.getElementById('sloc').value.trim();
  var err=document.getElementById('serr');
  if(!name||!em||!pw){err.textContent='Fill in all fields.';return;}
  if(pw.length<6){err.textContent='Password needs 6+ characters.';return;}
  err.textContent='';this.textContent='Creating...';this.disabled=true;
  var slowTimer=setTimeout(function(){err.style.color='#7c6af7';err.textContent='Starting up server... please wait 30 seconds ☕';},5000);
  // FIX: Node.js backend route is /auth/signup (NOT /auth/register)
  // FIX: Node.js expects full_name (NOT name)
  var r=await api('/auth/signup','POST',{full_name:name,email:em,password:pw,location:loc});
  clearTimeout(slowTimer);err.style.color='#e24b4a';this.textContent='Create Account';this.disabled=false;
  if(r.ok){
    token=r.data.token;
    user=r.data.user;
    if(user&&!user.full_name&&user.name)user.full_name=user.name;
    if(user&&!user.name&&user.full_name)user.name=user.full_name;
    localStorage.setItem('wm_token',token);
    localStorage.setItem('wm_user',JSON.stringify(user));
    enterApp();
  }else if(r.data.message&&r.data.message.indexOf('already exists')>-1){
    // Account exists - try logging in instead
    err.style.color='#7c6af7';err.textContent='Account found! Signing you in...';
    var lr=await api('/auth/login','POST',{email:em,password:pw});
    if(lr.ok){
      token=lr.data.token;user=lr.data.user;
      if(user&&!user.full_name&&user.name)user.full_name=user.name;
      if(user&&!user.name&&user.full_name)user.name=user.full_name;
      localStorage.setItem('wm_token',token);
      localStorage.setItem('wm_user',JSON.stringify(user));
      enterApp();
    }else{
      err.style.color='#e24b4a';
      err.textContent='Account exists. Please sign in instead.';
      setTimeout(function(){show('pg-login');document.getElementById('lemail').value=em;},1500);
    }
  }else{
    err.textContent=r.data.message||'Signup failed.';
  }
};

// Switch between login and signup screens
document.getElementById('gosu').onclick=function(){show('pg-signup');};
document.getElementById('goli').onclick=function(){show('pg-login');};

// ── NAV WIRING ──────────────────────────
document.getElementById('n1').onclick=goFeed;document.getElementById('n2').onclick=goMatch;document.getElementById('n3').onclick=goMessages;document.getElementById('n4').onclick=goProf;
document.getElementById('n5').onclick=goFeed;document.getElementById('n6').onclick=goMatch;document.getElementById('n7').onclick=goMessages;document.getElementById('n8').onclick=goProf;
document.getElementById('n9').onclick=goFeed;document.getElementById('n10').onclick=goMatch;document.getElementById('n11').onclick=goMessages;document.getElementById('n12').onclick=goProf;
document.getElementById('n13').onclick=goFeed;document.getElementById('n14').onclick=goMatch;document.getElementById('n15').onclick=goMessages;document.getElementById('n16').onclick=goProf;
document.getElementById('nm1').onclick=goFeed;document.getElementById('nm2').onclick=goMatch;document.getElementById('nm3').onclick=goMessages;document.getElementById('nm4').onclick=goProf;

// Back button in chat
document.getElementById('cbk').onclick=function(){show('pg-matches');};

// Sign out
document.getElementById('logbtn').onclick=function(){
  token=null;user=null;
  localStorage.removeItem('wm_token');
  localStorage.removeItem('wm_user');
  show('pg-login');
};

// Close creator modal
document.getElementById('cmx').onclick=function(){document.getElementById('cmask').classList.remove('on');};
document.getElementById('cmask').onclick=function(e){if(e.target===this)this.classList.remove('on');};

// Send message
document.getElementById('csend').onclick=sendMsg;
document.getElementById('cbox').onkeydown=function(e){if(e.key==='Enter')sendMsg();};

// Avatar upload
document.getElementById('pav-wrap').onclick=function(){document.getElementById('avatar-file').click();};
document.getElementById('avatar-file').onchange=async function(){
  var f=this.files[0];if(!f)return;
  var pavEl=document.getElementById('pav');
  pavEl.innerHTML='<div style="font-size:11px;color:#aaa;">...</div>';
  var reader=new FileReader();
  reader.onload=async function(e){
    // Node.js: PUT /api/auth/profile
    var r=await api('/auth/profile','PUT',{avatar_base64:e.target.result});
    if(r.ok&&r.data.user&&r.data.user.avatar_url){
      user.avatar_url=r.data.user.avatar_url;
      pavEl.innerHTML='<img src="'+user.avatar_url+'" alt="avatar"/>';
      showAvatarToast('✅ Profile photo updated!');
    }else{
      pavEl.textContent=ini(user.full_name||user.name);
      showAvatarToast('❌ Upload failed, try again');
    }
  };
  reader.readAsDataURL(f);
};

// Close user profile modal
document.getElementById('user-profile-close').onclick=function(){
  document.getElementById('user-profile-mask').classList.remove('on');
  pickAndPlayBestSlide();
};
document.getElementById('user-profile-mask').onclick=function(e){
  if(e.target===this)this.classList.remove('on');
};

// ── GOOGLE SIGN IN ──────────────────────────
var GOOGLE_CLIENT_ID='855168386507-5tjaea79rg95ghmjb57eirpggeoapj9b.apps.googleusercontent.com';

function triggerGoogleSignIn(){
  var errEl=document.getElementById('lerr')||document.getElementById('serr');
  if(errEl)errEl.textContent='';
  google.accounts.id.initialize({
    client_id:GOOGLE_CLIENT_ID,
    callback:handleGoogleSignIn,
    auto_select:false,
    cancel_on_tap_outside:true
  });
  var container=document.getElementById('g-btn-container');
  if(container){
    container.innerHTML='';
    google.accounts.id.renderButton(container,{theme:'filled_black',size:'large',width:280,text:'continue_with',shape:'rectangular'});
    setTimeout(function(){var btn=container.querySelector('div[role=button]');if(btn)btn.click();},300);
  }
}

var gIcon='<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>';

function resetGoogleBtns(){
  var lbtn=document.getElementById('google-login-btn');
  var sbtn=document.getElementById('google-signup-btn');
  if(lbtn)lbtn.innerHTML=gIcon+' Continue with Google';
  if(sbtn)sbtn.innerHTML=gIcon+' Sign up with Google';
}

function loginSuccess(data){
  token=data.token;
  user=data.user;
  if(user&&!user.full_name&&user.name)user.full_name=user.name;
  if(user&&!user.name&&user.full_name)user.name=user.full_name;
  localStorage.setItem('wm_token',token);
  localStorage.setItem('wm_user',JSON.stringify(user));
  enterApp();
}

async function handleGoogleSignIn(googleResponse){
  var errEl=document.getElementById('lerr')||document.getElementById('serr');
  var lbtn=document.getElementById('google-login-btn');
  if(lbtn)lbtn.textContent='Signing in...';
  // Node.js: POST /api/auth/google
  var r=await api('/auth/google','POST',{id_token:googleResponse.credential});
  resetGoogleBtns();
  if(r.ok)loginSuccess(r.data);
  else if(errEl)errEl.textContent=r.data.message||'Google sign in failed.';
}

async function handleGoogleCallback(code){
  var errEl=document.getElementById('lerr')||document.getElementById('serr');
  var r=await api('/auth/google/mobile','POST',{code:code,redirect_uri:BACKEND+'/api/auth/google/callback'});
  resetGoogleBtns();
  if(r.ok)loginSuccess(r.data);
  else if(errEl)errEl.textContent=r.data.message||'Google sign in failed.';
}

async function exchangeGoogleToken(accessToken){
  var errEl=document.getElementById('lerr')||document.getElementById('serr');
  try{
    var resp=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+accessToken}});
    var gUser=await resp.json();
    // Node.js: POST /api/auth/google/token
    var r=await api('/auth/google/token','POST',{access_token:accessToken,user:gUser});
    resetGoogleBtns();
    if(r.ok)loginSuccess(r.data);
    else if(errEl)errEl.textContent=r.data.message||'Google sign in failed.';
  }catch(e){if(errEl)errEl.textContent='Google sign in failed. Try again.';}
}

window.addEventListener('message',function(e){
  if(e.data&&e.data.type==='google-auth'&&e.data.code)handleGoogleCallback(e.data.code);
});

// ── INIT ──────────────────────────
window.onload=function(){
  var hash=window.location.hash;
  if(hash&&hash.indexOf('access_token')>-1){
    var params=new URLSearchParams(hash.substring(1));
    var accessToken=params.get('access_token');
    if(accessToken){
      history.replaceState(null,null,window.location.pathname);
      exchangeGoogleToken(accessToken);
      return;
    }
  }
  if(token&&user)enterApp();
};
