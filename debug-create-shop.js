// Debug script for create-shop.html
console.log('Supabase available:', !!window.supabase);
if (window.supabase) {
  window.supabase.auth.getSession().then(({ data, error }) => {
    console.log('Supabase session:', data);
    if (error) console.error('Session error:', error);
    if (data && data.session && data.session.user) {
      console.log('User metadata:', data.session.user.user_metadata);
      console.log('User email:', data.session.user.email);
    }
  });
}
