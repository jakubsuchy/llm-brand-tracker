import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { Shield, Plus, Pencil, Key, Trash2, UserCog, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

type User = {
  id: number;
  email: string;
  fullName: string;
  roles: string[];
  createdAt: string;
};

type GoogleConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
};

type SamlConfig = {
  enabled: boolean;
  entryPoint: string;
  issuer: string;
  cert: string;
  signatureAlgorithm: string;
  wantAssertionsSigned: boolean;
  wantResponseSigned: boolean;
};

type AuthProvidersConfig = {
  google: GoogleConfig;
  saml: SamlConfig;
};

const AVAILABLE_ROLES = ["user", "analyst", "admin"];

function AuthProvidersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [googleOpen, setGoogleOpen] = useState(false);
  const [samlOpen, setSamlOpen] = useState(false);

  const [isSavingGoogle, setIsSavingGoogle] = useState(false);
  const [isSavingSaml, setIsSavingSaml] = useState(false);

  const { data: config, isLoading } = useQuery<AuthProvidersConfig>({
    queryKey: ['/api/auth/providers'],
  });

  // Google form state
  const [googleEnabled, setGoogleEnabled] = useState<boolean | undefined>(undefined);
  const [googleClientId, setGoogleClientId] = useState<string | undefined>(undefined);
  const [googleClientSecret, setGoogleClientSecret] = useState<string | undefined>(undefined);
  const [googleAutoCreate, setGoogleAutoCreate] = useState<boolean | undefined>(undefined);
  const [googleAllowedDomain, setGoogleAllowedDomain] = useState<string | undefined>(undefined);

  // SAML form state
  const [samlEnabled, setSamlEnabled] = useState<boolean | undefined>(undefined);
  const [samlEntryPoint, setSamlEntryPoint] = useState<string | undefined>(undefined);
  const [samlIssuer, setSamlIssuer] = useState<string | undefined>(undefined);
  const [samlCert, setSamlCert] = useState<string | undefined>(undefined);
  const [samlSignatureAlgorithm, setSamlSignatureAlgorithm] = useState<string | undefined>(undefined);
  const [samlWantAssertionsSigned, setSamlWantAssertionsSigned] = useState<boolean | undefined>(undefined);
  const [samlWantResponseSigned, setSamlWantResponseSigned] = useState<boolean | undefined>(undefined);
  const [samlAutoCreate, setSamlAutoCreate] = useState<boolean | undefined>(undefined);
  const [samlAllowedDomain, setSamlAllowedDomain] = useState<string | undefined>(undefined);

  // Derived values: use local state if set, otherwise fall back to server data
  const gEnabled = googleEnabled ?? config?.google?.enabled ?? false;
  const gClientId = googleClientId ?? config?.google?.clientId ?? "";
  const gClientSecret = googleClientSecret ?? config?.google?.clientSecret ?? "";
  const gAutoCreate = googleAutoCreate ?? config?.google?.autoCreateUsers ?? true;
  const gAllowedDomain = googleAllowedDomain ?? config?.google?.allowedDomain ?? "";

  const sEnabled = samlEnabled ?? config?.saml?.enabled ?? false;
  const sEntryPoint = samlEntryPoint ?? config?.saml?.entryPoint ?? "";
  const sIssuer = samlIssuer ?? config?.saml?.issuer ?? "";
  const sCert = samlCert ?? config?.saml?.cert ?? "";
  const sSignatureAlgorithm = samlSignatureAlgorithm ?? config?.saml?.signatureAlgorithm ?? "sha256";
  const sWantAssertionsSigned = samlWantAssertionsSigned ?? config?.saml?.wantAssertionsSigned ?? false;
  const sWantResponseSigned = samlWantResponseSigned ?? config?.saml?.wantResponseSigned ?? false;
  const sAutoCreate = samlAutoCreate ?? config?.saml?.autoCreateUsers ?? true;
  const sAllowedDomain = samlAllowedDomain ?? config?.saml?.allowedDomain ?? "";

  const handleSaveGoogle = async () => {
    setIsSavingGoogle(true);
    try {
      const googlePayload = {
        enabled: gEnabled,
        clientId: gClientId,
        clientSecret: gClientSecret,
        autoCreateUsers: gAutoCreate,
        allowedDomain: gAllowedDomain || undefined,
      };
      await apiRequest('POST', '/api/auth/providers', { google: googlePayload });
      toast({ title: "Google OAuth saved", description: "Google OAuth configuration has been updated" });
      setGoogleEnabled(undefined);
      setGoogleClientId(undefined);
      setGoogleClientSecret(undefined);
      setGoogleAutoCreate(undefined);
      setGoogleAllowedDomain(undefined);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/providers'] });
    } catch {
      toast({ title: "Failed to save", description: "An error occurred saving Google OAuth configuration.", variant: "destructive" });
    } finally {
      setIsSavingGoogle(false);
    }
  };

  const handleSaveSaml = async () => {
    setIsSavingSaml(true);
    try {
      const samlPayload = {
        enabled: sEnabled,
        entryPoint: sEntryPoint,
        issuer: sIssuer,
        cert: sCert,
        signatureAlgorithm: sSignatureAlgorithm,
        wantAssertionsSigned: sWantAssertionsSigned,
        wantResponseSigned: sWantResponseSigned,
        autoCreateUsers: sAutoCreate,
        allowedDomain: sAllowedDomain || undefined,
      };
      await apiRequest('POST', '/api/auth/providers', { saml: samlPayload });
      toast({ title: "SAML saved", description: "SAML configuration has been updated" });
      setSamlEnabled(undefined);
      setSamlEntryPoint(undefined);
      setSamlIssuer(undefined);
      setSamlCert(undefined);
      setSamlSignatureAlgorithm(undefined);
      setSamlWantAssertionsSigned(undefined);
      setSamlWantResponseSigned(undefined);
      setSamlAutoCreate(undefined);
      setSamlAllowedDomain(undefined);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/providers'] });
    } catch {
      toast({ title: "Failed to save", description: "An error occurred saving SAML configuration.", variant: "destructive" });
    } finally {
      setIsSavingSaml(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-gray-500">Loading configuration...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Google OAuth Section */}
      <Collapsible open={googleOpen} onOpenChange={setGoogleOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {googleOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <CardTitle className="text-lg">Google OAuth</CardTitle>
                  {gEnabled ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200">Enabled</Badge>
                  ) : (
                    <Badge variant="outline" className="text-gray-500">Disabled</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-3">
                <Switch
                  id="google-enabled"
                  checked={gEnabled}
                  onCheckedChange={setGoogleEnabled}
                />
                <Label htmlFor="google-enabled">Enabled</Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="google-client-id">Client ID</Label>
                <Input
                  id="google-client-id"
                  type="text"
                  placeholder="your-client-id.apps.googleusercontent.com"
                  value={gClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="google-client-secret">Client Secret</Label>
                <Input
                  id="google-client-secret"
                  type="password"
                  placeholder="Enter client secret"
                  value={gClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="google-callback">Callback URL</Label>
                <Input
                  id="google-callback"
                  type="text"
                  value="/api/auth/google/callback"
                  readOnly
                  className="bg-muted"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <div className="text-sm font-medium">Auto-create new users</div>
                  <p className="text-xs text-muted-foreground">Automatically create accounts for new Google users with "user" role</p>
                </div>
                <Switch checked={gAutoCreate} onCheckedChange={setGoogleAutoCreate} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="google-domain">Limit logins to domain</Label>
                <Input
                  id="google-domain"
                  type="text"
                  placeholder="example.com"
                  value={gAllowedDomain}
                  onChange={(e) => setGoogleAllowedDomain(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">If set, only emails from this domain can sign in. Leave empty to allow all.</p>
              </div>

              <p className="text-sm text-muted-foreground">
                Create credentials at{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline inline-flex items-center gap-1"
                >
                  Google Cloud Console
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>

              <div className="flex justify-end">
                <Button onClick={handleSaveGoogle} disabled={isSavingGoogle}>
                  {isSavingGoogle ? "Saving..." : "Save Google OAuth"}
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* SAML Section */}
      <Collapsible open={samlOpen} onOpenChange={setSamlOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {samlOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <CardTitle className="text-lg">SAML</CardTitle>
                  {sEnabled ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200">Enabled</Badge>
                  ) : (
                    <Badge variant="outline" className="text-gray-500">Disabled</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-3">
                <Switch
                  id="saml-enabled"
                  checked={sEnabled}
                  onCheckedChange={setSamlEnabled}
                />
                <Label htmlFor="saml-enabled">Enabled</Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="saml-entry-point">Entry Point / SSO URL</Label>
                <Input
                  id="saml-entry-point"
                  type="text"
                  placeholder="https://idp.example.com/sso/saml"
                  value={sEntryPoint}
                  onChange={(e) => setSamlEntryPoint(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Your Identity Provider's login URL</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="saml-issuer">Issuer / Entity ID</Label>
                <Input
                  id="saml-issuer"
                  type="text"
                  placeholder="urn:brand-tracker:saml"
                  value={sIssuer}
                  onChange={(e) => setSamlIssuer(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Your application's identifier</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="saml-cert">IdP Certificate</Label>
                <Textarea
                  id="saml-cert"
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  value={sCert}
                  onChange={(e) => setSamlCert(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">PEM-encoded certificate from your Identity Provider</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="saml-callback">Callback URL</Label>
                <Input
                  id="saml-callback"
                  type="text"
                  value="/api/auth/saml/callback"
                  readOnly
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label>Metadata URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value="/api/auth/saml/metadata"
                    readOnly
                    className="bg-muted"
                  />
                  <a
                    href="/api/auth/saml/metadata"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="saml-signature-algorithm">Signature Algorithm</Label>
                <Select
                  value={sSignatureAlgorithm}
                  onValueChange={setSamlSignatureAlgorithm}
                >
                  <SelectTrigger id="saml-signature-algorithm">
                    <SelectValue placeholder="Select algorithm" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sha256">SHA-256</SelectItem>
                    <SelectItem value="sha512">SHA-512</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-3">
                <Checkbox
                  id="saml-want-assertions-signed"
                  checked={sWantAssertionsSigned}
                  onCheckedChange={(checked) => setSamlWantAssertionsSigned(checked === true)}
                />
                <Label htmlFor="saml-want-assertions-signed" className="cursor-pointer">
                  Want Assertions Signed
                </Label>
              </div>

              <div className="flex items-center space-x-3">
                <Checkbox
                  id="saml-want-response-signed"
                  checked={sWantResponseSigned}
                  onCheckedChange={(checked) => setSamlWantResponseSigned(checked === true)}
                />
                <Label htmlFor="saml-want-response-signed" className="cursor-pointer">
                  Want Response Signed
                </Label>
              </div>

              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <div className="text-sm font-medium">Auto-create new users</div>
                  <p className="text-xs text-muted-foreground">Automatically create accounts for new SAML users with "user" role</p>
                </div>
                <Switch checked={sAutoCreate} onCheckedChange={setSamlAutoCreate} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="saml-domain">Limit logins to domain</Label>
                <Input
                  id="saml-domain"
                  type="text"
                  placeholder="example.com"
                  value={sAllowedDomain}
                  onChange={(e) => setSamlAllowedDomain(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">If set, only emails from this domain can sign in. Leave empty to allow all.</p>
              </div>

              <p className="text-sm text-muted-foreground">
                Configure your Identity Provider with the callback URL and metadata.
              </p>

              <div className="flex justify-end">
                <Button onClick={handleSaveSaml} disabled={isSavingSaml}>
                  {isSavingSaml ? "Saving..." : "Save SAML"}
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

export default function UsersPage() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['/api/users'],
  });

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [rolesUser, setRolesUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

  // Create user form
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRoles, setCreateRoles] = useState<string[]>(["user"]);
  const [isCreating, setIsCreating] = useState(false);

  // Edit user form
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  // Password form
  const [newPassword, setNewPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Roles form
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isSavingRoles, setIsSavingRoles] = useState(false);

  const [isDeleting, setIsDeleting] = useState(false);

  const handleCreateUser = async () => {
    if (!createEmail.trim() || !createName.trim() || !createPassword.trim()) {
      toast({ title: "Missing fields", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      await apiRequest('POST', '/api/users', {
        email: createEmail,
        fullName: createName,
        password: createPassword,
        roles: createRoles,
      });
      toast({ title: "User created", description: `${createName} has been added` });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setCreateOpen(false);
      setCreateEmail("");
      setCreateName("");
      setCreatePassword("");
      setCreateRoles(["user"]);
    } catch (error: any) {
      const msg = error?.message || "";
      toast({
        title: "Failed to create user",
        description: msg.includes("409") ? "A user with that email already exists" : "An error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditUser = async () => {
    if (!editUser) return;
    if (!editEmail.trim() || !editName.trim()) {
      toast({ title: "Missing fields", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    setIsEditing(true);
    try {
      await apiRequest('PUT', `/api/users/${editUser.id}`, {
        email: editEmail,
        fullName: editName,
      });
      toast({ title: "User updated", description: `${editName} has been updated` });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setEditUser(null);
    } catch (error: any) {
      const msg = error?.message || "";
      toast({
        title: "Failed to update user",
        description: msg.includes("409") ? "A user with that email already exists" : "An error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsEditing(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordUser) return;
    if (!newPassword.trim() || newPassword.length < 8) {
      toast({ title: "Invalid password", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setIsChangingPassword(true);
    try {
      await apiRequest('PUT', `/api/users/${passwordUser.id}/password`, { password: newPassword });
      toast({ title: "Password changed", description: `Password updated for ${passwordUser.fullName}` });
      setPasswordUser(null);
      setNewPassword("");
    } catch {
      toast({ title: "Failed to change password", description: "An error occurred. Please try again.", variant: "destructive" });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSaveRoles = async () => {
    if (!rolesUser) return;
    setIsSavingRoles(true);
    try {
      await apiRequest('POST', `/api/users/${rolesUser.id}/roles`, { roles: selectedRoles });
      toast({ title: "Roles updated", description: `Roles updated for ${rolesUser.fullName}` });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setRolesUser(null);
    } catch {
      toast({ title: "Failed to update roles", description: "An error occurred. Please try again.", variant: "destructive" });
    } finally {
      setIsSavingRoles(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;
    setIsDeleting(true);
    try {
      await apiRequest('DELETE', `/api/users/${deleteUser.id}`);
      toast({ title: "User deleted", description: `${deleteUser.fullName} has been removed` });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      setDeleteUser(null);
    } catch {
      toast({ title: "Failed to delete user", description: "An error occurred. Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const openEditDialog = (user: User) => {
    setEditEmail(user.email);
    setEditName(user.fullName);
    setEditUser(user);
  };

  const openRolesDialog = (user: User) => {
    setSelectedRoles([...user.roles]);
    setRolesUser(user);
  };

  const toggleCreateRole = (role: string) => {
    setCreateRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const toggleSelectedRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const roleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800 border-red-200';
      case 'analyst': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-gray-600">Manage user accounts, roles, and authentication providers</p>
        </div>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="auth-providers">Auth Providers</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create User
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12 text-gray-500">Loading users...</div>
                ) : users.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-gray-500">No users found</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">{user.fullName}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {user.roles.map((role) => (
                                <Badge key={role} variant="outline" className={roleColor(role)}>
                                  {role}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>{formatDate(user.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditDialog(user)}
                                title="Edit user"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => { setNewPassword(""); setPasswordUser(user); }}
                                title="Change password"
                              >
                                <Key className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openRolesDialog(user)}
                                title="Manage roles"
                              >
                                <UserCog className="h-4 w-4" />
                              </Button>
                              {user.id !== currentUser?.id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteUser(user)}
                                  title="Delete user"
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="auth-providers">
          <AuthProvidersTab />
        </TabsContent>
      </Tabs>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>Add a new user account to the system.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-email">Email</Label>
              <Input
                id="create-email"
                type="email"
                placeholder="user@example.com"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-name">Full Name</Label>
              <Input
                id="create-name"
                type="text"
                placeholder="Jane Doe"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">Password</Label>
              <Input
                id="create-password"
                type="password"
                placeholder="At least 8 characters"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Roles</Label>
              <div className="flex gap-4">
                {AVAILABLE_ROLES.map((role) => (
                  <div key={role} className="flex items-center space-x-2">
                    <Checkbox
                      id={`create-role-${role}`}
                      checked={createRoles.includes(role)}
                      onCheckedChange={() => toggleCreateRole(role)}
                    />
                    <Label htmlFor={`create-role-${role}`} className="capitalize cursor-pointer">
                      {role}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateUser} disabled={isCreating}>
              {isCreating ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleEditUser} disabled={isEditing}>
              {isEditing ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={!!passwordUser} onOpenChange={(open) => { if (!open) setPasswordUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>
              Set a new password for {passwordUser?.fullName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordUser(null)}>Cancel</Button>
            <Button onClick={handleChangePassword} disabled={isChangingPassword}>
              {isChangingPassword ? "Changing..." : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Roles Dialog */}
      <Dialog open={!!rolesUser} onOpenChange={(open) => { if (!open) setRolesUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Roles</DialogTitle>
            <DialogDescription>
              Update roles for {rolesUser?.fullName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-4">
              {AVAILABLE_ROLES.map((role) => (
                <div key={role} className="flex items-center space-x-2">
                  <Checkbox
                    id={`role-${role}`}
                    checked={selectedRoles.includes(role)}
                    onCheckedChange={() => toggleSelectedRole(role)}
                  />
                  <Label htmlFor={`role-${role}`} className="capitalize cursor-pointer">
                    {role}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesUser(null)}>Cancel</Button>
            <Button onClick={handleSaveRoles} disabled={isSavingRoles}>
              {isSavingRoles ? "Saving..." : "Save Roles"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={(open) => { if (!open) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {deleteUser?.fullName} ({deleteUser?.email})?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-red-600 hover:bg-red-700"
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
