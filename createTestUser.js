import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://eyfvqdnczorscwveaadv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5ZnZxZG5jem9yc2N3dmVhYWR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NTEwMjksImV4cCI6MjA4NDAyNzAyOX0.4sEp3Z2D3BNSPjaX57HhEUr_yRTX8BUHayjZkY8X4CI';

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTestLogin() {
  console.log("Creating test user at 'test2@amani.app' with password 'password123'");
  const { data, error } = await supabase.auth.signUp({
    email: 'test2@amani.app',
    password: 'password123',
  });

  if (error) {
    console.error("Auth Error:", error.message);
    return;
  }

  const user = data.user;
  if (!user) {
    console.error("No user returned");
    return;
  }

  console.log(`User created with ID: ${user.id}`);
  
  // Authenticate as the user we just signed up
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: 'test2@amani.app',
    password: 'password123',
  });

  if (signInError) {
    console.error("SignIn Error:", signInError.message);
  } else {
    // Create profile using the authenticated session
    const { error: profileError } = await supabase.from('users').insert({
      id: user.id,
      email: user.email
    });

    if (profileError) {
      console.error("Profile Error:", profileError.message);
      if(profileError.message.includes("duplicate key")){
        console.log("Profile already exists.");
      }
    } else {
      console.log("Successfully created user and authenticated to create profile row!");
    }
  }

  console.log("You can now login with:");
  console.log("Email: test2@amani.app");
  console.log("Password: password123");
}

createTestLogin();
