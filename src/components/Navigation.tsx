@@ .. @@
 import React from 'react';
 import { Link, useLocation } from 'react-router-dom';
-import { Home, FileText, Upload, Calendar, Activity, LogOut } from 'lucide-react';
+import { Home, FileText, Upload, Calendar, Activity, CreditCard, LogOut } from 'lucide-react';
 import { useAuth } from '../contexts/AuthContext';
 
@@ .. @@
     { name: 'Upload', href: '/upload', icon: Upload },
     { name: 'Reports', href: '/reports', icon: FileText },
     { name: 'Cycle Tracking', href: '/cycle', icon: Calendar },
     { name: 'Interventions', href: '/interventions', icon: Activity },
+    { name: 'Pricing', href: '/pricing', icon: CreditCard },
   ];
 
@@ .. @@