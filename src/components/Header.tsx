@@ .. @@
 import React from 'react';
 import { Link, useNavigate } from 'react-router-dom';
 import { Activity, LogOut, User, Upload, BarChart3, Calendar, Pill } from 'lucide-react';
 import { useAuth } from '../hooks/useAuth';
+import { SubscriptionStatus } from './SubscriptionStatus';
 
 export function Header() {
   const { user, signOut } = useAuth();
@@ .. @@
           <div className="flex items-center space-x-4">
             <span className="text-sm text-gray-600">Welcome, {user.email}</span>
+            <SubscriptionStatus />
             <button
               onClick={handleSignOut}
               className="flex items-center space-x-1 text-gray-600 hover:text-gray-900 transition-colors"