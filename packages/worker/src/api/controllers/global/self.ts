import * as userSdk from "../../../sdk/users"
import {
  featureFlags,
  tenancy,
  constants,
  db as dbCore,
  utils,
  encryption,
  auth as authCore,
} from "@budibase/backend-core"
import env from "../../../environment"
import { groups } from "@budibase/pro"
import {
  UpdateSelfRequest,
  UpdateSelfResponse,
  UpdateSelf,
  UserCtx,
} from "@budibase/types"
const { getCookie, clearCookie, newid } = utils

function newTestApiKey() {
  return env.ENCRYPTED_TEST_PUBLIC_API_KEY
}

function newApiKey() {
  return encryption.encrypt(
    `${tenancy.getTenantId()}${dbCore.SEPARATOR}${newid()}`
  )
}

function cleanupDevInfo(info: any) {
  // user doesn't need to aware of dev doc info
  delete info._id
  delete info._rev
  return info
}

export async function generateAPIKey(ctx: any) {
  let userId
  let apiKey
  if (env.isTest() && ctx.request.body.userId) {
    userId = ctx.request.body.userId
    apiKey = newTestApiKey()
  } else {
    userId = ctx.user._id
    apiKey = newApiKey()
  }

  const db = tenancy.getGlobalDB()
  const id = dbCore.generateDevInfoID(userId)
  let devInfo
  try {
    devInfo = await db.get(id)
  } catch (err) {
    devInfo = { _id: id, userId }
  }
  devInfo.apiKey = await apiKey
  await db.put(devInfo)
  ctx.body = cleanupDevInfo(devInfo)
}

export async function fetchAPIKey(ctx: any) {
  const db = tenancy.getGlobalDB()
  const id = dbCore.generateDevInfoID(ctx.user._id)
  let devInfo
  try {
    devInfo = await db.get(id)
  } catch (err) {
    devInfo = {
      _id: id,
      userId: ctx.user._id,
      apiKey: await newApiKey(),
    }
    await db.put(devInfo)
  }
  ctx.body = cleanupDevInfo(devInfo)
}

const checkCurrentApp = (ctx: any) => {
  const appCookie = getCookie(ctx, constants.Cookie.CurrentApp)
  if (appCookie && !tenancy.isUserInAppTenant(appCookie.appId)) {
    // there is a currentapp cookie from another tenant
    // remove the cookie as this is incompatible with the builder
    // due to builder and admin permissions being removed
    clearCookie(ctx, constants.Cookie.CurrentApp)
  }
}

/**
 * Add the attributes that are session based to the current user.
 */
const addSessionAttributesToUser = (ctx: any) => {
  ctx.body.account = ctx.user.account
  ctx.body.license = ctx.user.license
  ctx.body.budibaseAccess = !!ctx.user.budibaseAccess
  ctx.body.accountPortalAccess = !!ctx.user.accountPortalAccess
  ctx.body.csrfToken = ctx.user.csrfToken
}

export async function getSelf(ctx: any) {
  if (!ctx.user) {
    ctx.throw(403, "User not logged in")
  }
  const userId = ctx.user._id
  ctx.params = {
    id: userId,
  }

  checkCurrentApp(ctx)

  // get the main body of the user
  const user = await userSdk.getUser(userId)
  ctx.body = await groups.enrichUserRolesFromGroups(user)

  // add the feature flags for this tenant
  const tenantId = tenancy.getTenantId()
  ctx.body.featureFlags = featureFlags.getTenantFeatureFlags(tenantId)

  addSessionAttributesToUser(ctx)
}

export async function updateSelf(
  ctx: UserCtx<UpdateSelfRequest, UpdateSelfResponse>
) {
  const body = ctx.request.body
  const update: UpdateSelf = {
    firstName: body.firstName,
    lastName: body.lastName,
    password: body.password,
    forceResetPassword: body.forceResetPassword,
  }

  const user = await userSdk.updateSelf(ctx.user._id!, update)

  if (update.password) {
    // Log all other sessions out apart from the current one
    await authCore.platformLogout({
      ctx,
      userId: ctx.user._id!,
      keepActiveSession: true,
    })
  }

  ctx.body = {
    _id: user._id!,
    _rev: user._rev!,
  }
}
