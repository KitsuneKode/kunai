---------------------------- MODULE VersionLock ----------------------------
(***************************************************************************)
(* Model of tryAcquireVersionLock / release in                              *)
(* apps/cli/src/services/update/native-installer/version-lock.ts.           *)
(*                                                                          *)
(* Separate processes share the lock file and its `.claim` file. Nothing   *)
(* is atomic across processes except one filesystem syscall, so every      *)
(* syscall in the code is one step here: existsSync, statOrNull, each      *)
(* readFile, each `wx` create, each write, each rm.  A process may crash   *)
(* between any two steps and leave its files behind.                       *)
(*                                                                          *)
(* A file is "none", "empty" (created, not yet written: the moment between *)
(* the O_EXCL/O_TRUNC open and the write), or "full" with its writer's pid.*)
(* `g` is the file's identity (inode + mtime): it changes on every create  *)
(* or write.                                                               *)
(*                                                                          *)
(* Time is abstracted to one assumption, GraceHonored: a live process      *)
(* finishes writing a file it created within LIFECYCLE_CORRUPT_GRACE_MS.   *)
(* So an empty file is "past grace" only once its creator is dead; a full  *)
(* file may be past grace or not (TLC tries both).                         *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Procs, GraceHonored

None == [kind |-> "none", who |-> "nobody", g |-> 0]

(* What readFile + JSON.parse yields: a pid for a full file, else invalid. *)
Content(f) == IF f.kind = "full" THEN f.who ELSE "invalid"

(*--algorithm VersionLock
variables
  lock = None,
  claim = None,
  gen = 0,
  alive = Procs,
  holds = {};

define
  PastGrace(f) ==
    \/ f.kind = "none"
    \/ f.kind = "empty" /\ (~GraceHonored \/ f.who \notin alive)
    \/ f.kind = "full"
end define;

process P \in Procs
variables
  judgedG = 0, judgedC = "invalid", staleC = "invalid",
  claimRaw = "invalid", attempt = 0, claimHeld = FALSE,
  recheckG = 0;
begin
Exists:
  if lock.kind = "none" then goto CreateWx; else goto StatJudged; end if;

\* ---- fresh acquire: writeFile(path, content, { flag: "wx" }) ----
CreateWx:
  if lock.kind = "none" then
    gen := gen + 1; lock := [kind |-> "empty", who |-> self, g |-> gen];
  else
    goto Fail;
  end if;
FillWx:
  gen := gen + 1; lock := [kind |-> "full", who |-> self, g |-> gen];
  goto Got;

\* ---- reclaim: judge the file that is there ----
StatJudged:  judgedG := lock.g;
ReadJudged:  judgedC := Content(lock);
StaleRead:
  staleC := Content(lock);
  if staleC /= "invalid" then
    if staleC \in alive then goto Fail; else goto ClaimCreate; end if;
  end if;
StaleStat:   \* isPastCorruptGrace(path)
  with b \in {TRUE, FALSE} do
    if PastGrace(lock) /\ (lock.kind = "none" \/ b) then goto ClaimCreate;
    else goto Fail; end if;
  end with;

\* ---- serialize reapers through <lock>.claim (two attempts) ----
ClaimCreate:
  if claim.kind = "none" then
    gen := gen + 1; claim := [kind |-> "empty", who |-> self, g |-> gen];
  else
    goto ClaimRead;
  end if;
ClaimFill:
  gen := gen + 1; claim := [kind |-> "full", who |-> self, g |-> gen];
  claimHeld := TRUE;
  goto RecheckStat;
ClaimRead:
  claimRaw := Content(claim);
  if claimRaw /= "invalid" /\ claimRaw \in alive then goto Fail; end if;
ClaimGrace:  \* only consulted for an invalid (empty or vanished) claim
  if claimRaw = "invalid" then
    with b \in {TRUE, FALSE} do
      if ~(PastGrace(claim) /\ (claim.kind = "none" \/ b)) then goto Fail; end if;
    end with;
  end if;
ClaimReread:
  if Content(claim) /= claimRaw then goto NextAttempt; end if;
ClaimRm:
  claim := None;
NextAttempt:
  attempt := attempt + 1;
  if attempt < 2 then goto ClaimCreate; else goto Fail; end if;

\* ---- recheck identity and content, then rewrite in place ----
RecheckStat:  recheckG := lock.g;
RecheckRead:  \* sameFile needs BOTH stats non-null (g = 0 is a null stat)
  if recheckG = 0 \/ judgedG = 0 \/ recheckG /= judgedG \/ Content(lock) /= judgedC then
    goto RmClaimFail;
  end if;
Truncate:    \* writeFile(path, content) without wx: O_TRUNC, then write
  gen := gen + 1; lock := [kind |-> "empty", who |-> self, g |-> gen];
Rewrite:
  gen := gen + 1; lock := [kind |-> "full", who |-> self, g |-> gen];
RmClaim:     \* finally { rm(claimPath, { force: true }) } -- whoever owns it
  claim := None;
  goto Got;
RmClaimFail:
  claim := None;
  goto Fail;

Got:
  holds := holds \cup {self};
\* ---- release: read, and rm only if the file still names us ----
ReleaseRead:
  holds := holds \ {self};
  if Content(lock) /= self then goto Done; end if;
ReleaseRm:
  lock := None;
  goto Done;
Fail:
  skip;
end process;
end algorithm; *)
\* BEGIN TRANSLATION
VARIABLES lock, claim, gen, alive, holds, pc

(* define statement *)
PastGrace(f) ==
  \/ f.kind = "none"
  \/ f.kind = "empty" /\ (~GraceHonored \/ f.who \notin alive)
  \/ f.kind = "full"

VARIABLES judgedG, judgedC, staleC, claimRaw, attempt, claimHeld, recheckG

vars == << lock, claim, gen, alive, holds, pc, judgedG, judgedC, staleC, 
           claimRaw, attempt, claimHeld, recheckG >>

ProcSet == (Procs)

Init == (* Global variables *)
        /\ lock = None
        /\ claim = None
        /\ gen = 0
        /\ alive = Procs
        /\ holds = {}
        (* Process P *)
        /\ judgedG = [self \in Procs |-> 0]
        /\ judgedC = [self \in Procs |-> "invalid"]
        /\ staleC = [self \in Procs |-> "invalid"]
        /\ claimRaw = [self \in Procs |-> "invalid"]
        /\ attempt = [self \in Procs |-> 0]
        /\ claimHeld = [self \in Procs |-> FALSE]
        /\ recheckG = [self \in Procs |-> 0]
        /\ pc = [self \in ProcSet |-> "Exists"]

Exists(self) == /\ pc[self] = "Exists"
                /\ IF lock.kind = "none"
                      THEN /\ pc' = [pc EXCEPT ![self] = "CreateWx"]
                      ELSE /\ pc' = [pc EXCEPT ![self] = "StatJudged"]
                /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                judgedC, staleC, claimRaw, attempt, claimHeld, 
                                recheckG >>

CreateWx(self) == /\ pc[self] = "CreateWx"
                  /\ IF lock.kind = "none"
                        THEN /\ gen' = gen + 1
                             /\ lock' = [kind |-> "empty", who |-> self, g |-> gen']
                             /\ pc' = [pc EXCEPT ![self] = "FillWx"]
                        ELSE /\ pc' = [pc EXCEPT ![self] = "Fail"]
                             /\ UNCHANGED << lock, gen >>
                  /\ UNCHANGED << claim, alive, holds, judgedG, judgedC, 
                                  staleC, claimRaw, attempt, claimHeld, 
                                  recheckG >>

FillWx(self) == /\ pc[self] = "FillWx"
                /\ gen' = gen + 1
                /\ lock' = [kind |-> "full", who |-> self, g |-> gen']
                /\ pc' = [pc EXCEPT ![self] = "Got"]
                /\ UNCHANGED << claim, alive, holds, judgedG, judgedC, staleC, 
                                claimRaw, attempt, claimHeld, recheckG >>

StatJudged(self) == /\ pc[self] = "StatJudged"
                    /\ judgedG' = [judgedG EXCEPT ![self] = lock.g]
                    /\ pc' = [pc EXCEPT ![self] = "ReadJudged"]
                    /\ UNCHANGED << lock, claim, gen, alive, holds, judgedC, 
                                    staleC, claimRaw, attempt, claimHeld, 
                                    recheckG >>

ReadJudged(self) == /\ pc[self] = "ReadJudged"
                    /\ judgedC' = [judgedC EXCEPT ![self] = Content(lock)]
                    /\ pc' = [pc EXCEPT ![self] = "StaleRead"]
                    /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                    staleC, claimRaw, attempt, claimHeld, 
                                    recheckG >>

StaleRead(self) == /\ pc[self] = "StaleRead"
                   /\ staleC' = [staleC EXCEPT ![self] = Content(lock)]
                   /\ IF staleC'[self] /= "invalid"
                         THEN /\ IF staleC'[self] \in alive
                                    THEN /\ pc' = [pc EXCEPT ![self] = "Fail"]
                                    ELSE /\ pc' = [pc EXCEPT ![self] = "ClaimCreate"]
                         ELSE /\ pc' = [pc EXCEPT ![self] = "StaleStat"]
                   /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                   judgedC, claimRaw, attempt, claimHeld, 
                                   recheckG >>

StaleStat(self) == /\ pc[self] = "StaleStat"
                   /\ \E b \in {TRUE, FALSE}:
                        IF PastGrace(lock) /\ (lock.kind = "none" \/ b)
                           THEN /\ pc' = [pc EXCEPT ![self] = "ClaimCreate"]
                           ELSE /\ pc' = [pc EXCEPT ![self] = "Fail"]
                   /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                   judgedC, staleC, claimRaw, attempt, 
                                   claimHeld, recheckG >>

ClaimCreate(self) == /\ pc[self] = "ClaimCreate"
                     /\ IF claim.kind = "none"
                           THEN /\ gen' = gen + 1
                                /\ claim' = [kind |-> "empty", who |-> self, g |-> gen']
                                /\ pc' = [pc EXCEPT ![self] = "ClaimFill"]
                           ELSE /\ pc' = [pc EXCEPT ![self] = "ClaimRead"]
                                /\ UNCHANGED << claim, gen >>
                     /\ UNCHANGED << lock, alive, holds, judgedG, judgedC, 
                                     staleC, claimRaw, attempt, claimHeld, 
                                     recheckG >>

ClaimFill(self) == /\ pc[self] = "ClaimFill"
                   /\ gen' = gen + 1
                   /\ claim' = [kind |-> "full", who |-> self, g |-> gen']
                   /\ claimHeld' = [claimHeld EXCEPT ![self] = TRUE]
                   /\ pc' = [pc EXCEPT ![self] = "RecheckStat"]
                   /\ UNCHANGED << lock, alive, holds, judgedG, judgedC, 
                                   staleC, claimRaw, attempt, recheckG >>

ClaimRead(self) == /\ pc[self] = "ClaimRead"
                   /\ claimRaw' = [claimRaw EXCEPT ![self] = Content(claim)]
                   /\ IF claimRaw'[self] /= "invalid" /\ claimRaw'[self] \in alive
                         THEN /\ pc' = [pc EXCEPT ![self] = "Fail"]
                         ELSE /\ pc' = [pc EXCEPT ![self] = "ClaimGrace"]
                   /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                   judgedC, staleC, attempt, claimHeld, 
                                   recheckG >>

ClaimGrace(self) == /\ pc[self] = "ClaimGrace"
                    /\ IF claimRaw[self] = "invalid"
                          THEN /\ \E b \in {TRUE, FALSE}:
                                    IF ~(PastGrace(claim) /\ (claim.kind = "none" \/ b))
                                       THEN /\ pc' = [pc EXCEPT ![self] = "Fail"]
                                       ELSE /\ pc' = [pc EXCEPT ![self] = "ClaimReread"]
                          ELSE /\ pc' = [pc EXCEPT ![self] = "ClaimReread"]
                    /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                    judgedC, staleC, claimRaw, attempt, 
                                    claimHeld, recheckG >>

ClaimReread(self) == /\ pc[self] = "ClaimReread"
                     /\ IF Content(claim) /= claimRaw[self]
                           THEN /\ pc' = [pc EXCEPT ![self] = "NextAttempt"]
                           ELSE /\ pc' = [pc EXCEPT ![self] = "ClaimRm"]
                     /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                     judgedC, staleC, claimRaw, attempt, 
                                     claimHeld, recheckG >>

ClaimRm(self) == /\ pc[self] = "ClaimRm"
                 /\ claim' = None
                 /\ pc' = [pc EXCEPT ![self] = "NextAttempt"]
                 /\ UNCHANGED << lock, gen, alive, holds, judgedG, judgedC, 
                                 staleC, claimRaw, attempt, claimHeld, 
                                 recheckG >>

NextAttempt(self) == /\ pc[self] = "NextAttempt"
                     /\ attempt' = [attempt EXCEPT ![self] = attempt[self] + 1]
                     /\ IF attempt'[self] < 2
                           THEN /\ pc' = [pc EXCEPT ![self] = "ClaimCreate"]
                           ELSE /\ pc' = [pc EXCEPT ![self] = "Fail"]
                     /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                     judgedC, staleC, claimRaw, claimHeld, 
                                     recheckG >>

RecheckStat(self) == /\ pc[self] = "RecheckStat"
                     /\ recheckG' = [recheckG EXCEPT ![self] = lock.g]
                     /\ pc' = [pc EXCEPT ![self] = "RecheckRead"]
                     /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                     judgedC, staleC, claimRaw, attempt, 
                                     claimHeld >>

RecheckRead(self) == /\ pc[self] = "RecheckRead"
                     /\ IF recheckG[self] = 0 \/ judgedG[self] = 0 \/ recheckG[self] /= judgedG[self] \/ Content(lock) /= judgedC[self]
                           THEN /\ pc' = [pc EXCEPT ![self] = "RmClaimFail"]
                           ELSE /\ pc' = [pc EXCEPT ![self] = "Truncate"]
                     /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, 
                                     judgedC, staleC, claimRaw, attempt, 
                                     claimHeld, recheckG >>

Truncate(self) == /\ pc[self] = "Truncate"
                  /\ gen' = gen + 1
                  /\ lock' = [kind |-> "empty", who |-> self, g |-> gen']
                  /\ pc' = [pc EXCEPT ![self] = "Rewrite"]
                  /\ UNCHANGED << claim, alive, holds, judgedG, judgedC, 
                                  staleC, claimRaw, attempt, claimHeld, 
                                  recheckG >>

Rewrite(self) == /\ pc[self] = "Rewrite"
                 /\ gen' = gen + 1
                 /\ lock' = [kind |-> "full", who |-> self, g |-> gen']
                 /\ pc' = [pc EXCEPT ![self] = "RmClaim"]
                 /\ UNCHANGED << claim, alive, holds, judgedG, judgedC, staleC, 
                                 claimRaw, attempt, claimHeld, recheckG >>

RmClaim(self) == /\ pc[self] = "RmClaim"
                 /\ claim' = None
                 /\ pc' = [pc EXCEPT ![self] = "Got"]
                 /\ UNCHANGED << lock, gen, alive, holds, judgedG, judgedC, 
                                 staleC, claimRaw, attempt, claimHeld, 
                                 recheckG >>

RmClaimFail(self) == /\ pc[self] = "RmClaimFail"
                     /\ claim' = None
                     /\ pc' = [pc EXCEPT ![self] = "Fail"]
                     /\ UNCHANGED << lock, gen, alive, holds, judgedG, judgedC, 
                                     staleC, claimRaw, attempt, claimHeld, 
                                     recheckG >>

Got(self) == /\ pc[self] = "Got"
             /\ holds' = (holds \cup {self})
             /\ pc' = [pc EXCEPT ![self] = "ReleaseRead"]
             /\ UNCHANGED << lock, claim, gen, alive, judgedG, judgedC, staleC, 
                             claimRaw, attempt, claimHeld, recheckG >>

ReleaseRead(self) == /\ pc[self] = "ReleaseRead"
                     /\ holds' = holds \ {self}
                     /\ IF Content(lock) /= self
                           THEN /\ pc' = [pc EXCEPT ![self] = "Done"]
                           ELSE /\ pc' = [pc EXCEPT ![self] = "ReleaseRm"]
                     /\ UNCHANGED << lock, claim, gen, alive, judgedG, judgedC, 
                                     staleC, claimRaw, attempt, claimHeld, 
                                     recheckG >>

ReleaseRm(self) == /\ pc[self] = "ReleaseRm"
                   /\ lock' = None
                   /\ pc' = [pc EXCEPT ![self] = "Done"]
                   /\ UNCHANGED << claim, gen, alive, holds, judgedG, judgedC, 
                                   staleC, claimRaw, attempt, claimHeld, 
                                   recheckG >>

Fail(self) == /\ pc[self] = "Fail"
              /\ TRUE
              /\ pc' = [pc EXCEPT ![self] = "Done"]
              /\ UNCHANGED << lock, claim, gen, alive, holds, judgedG, judgedC, 
                              staleC, claimRaw, attempt, claimHeld, recheckG >>

P(self) == Exists(self) \/ CreateWx(self) \/ FillWx(self)
              \/ StatJudged(self) \/ ReadJudged(self) \/ StaleRead(self)
              \/ StaleStat(self) \/ ClaimCreate(self) \/ ClaimFill(self)
              \/ ClaimRead(self) \/ ClaimGrace(self) \/ ClaimReread(self)
              \/ ClaimRm(self) \/ NextAttempt(self) \/ RecheckStat(self)
              \/ RecheckRead(self) \/ Truncate(self) \/ Rewrite(self)
              \/ RmClaim(self) \/ RmClaimFail(self) \/ Got(self)
              \/ ReleaseRead(self) \/ ReleaseRm(self) \/ Fail(self)

(* Allow infinite stuttering to prevent deadlock on termination. *)
Terminating == /\ \A self \in ProcSet: pc[self] = "Done"
               /\ UNCHANGED vars

Next == (\E self \in Procs: P(self))
           \/ Terminating

Spec == Init /\ [][Next]_vars

Termination == <>(\A self \in ProcSet: pc[self] = "Done")

\* END TRANSLATION

(* Any live process may take its next step; any live process may crash.  *)
Crash == \E q \in alive :
           /\ alive' = alive \ {q}
           /\ holds' = holds \ {q}
           /\ UNCHANGED << lock, claim, gen, pc, judgedG, judgedC, staleC,
                           claimRaw, attempt, claimHeld, recheckG >>

Finished == /\ \A q \in Procs : q \notin alive \/ pc[q] = "Done"
            /\ UNCHANGED vars

LiveNext == (\E self \in alive : P(self)) \/ Crash \/ Finished

LiveSpec == Init /\ [][LiveNext]_vars

(* The promise: at most one live process believes it holds the lock.     *)
MutualExclusion == \A p, q \in holds : p = q

(* While a live process holds the lock, the file still names it.          *)
HolderOwnsFile == \A p \in holds : lock.kind = "full" /\ lock.who = p
=============================================================================
