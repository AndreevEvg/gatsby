const axios = require(`axios`)
const crypto = require(`crypto`)
const _ = require(`lodash`)
const { createRemoteFileNode } = require(`gatsby-source-filesystem`)

const makeTypeName = type => `drupal__${type.replace(/-/g, `_`)}`

// Get content digest of node.
const createContentDigest = obj =>
  crypto
    .createHash(`md5`)
    .update(JSON.stringify(obj))
    .digest(`hex`)

const processEntities = ents =>
  ents.map(ent => {
    const newEnt = {
      id: ent.id,
      internal: {
        type: ent.type,
      },
      ...ent.attributes,
      created: new Date(ent.attributes.created * 1000).toJSON(),
      changed: new Date(ent.attributes.changed * 1000).toJSON(),
    }
    if (newEnt.revision_timestamp) {
      newEnt.revision_timestamp = new Date(
        newEnt.revision_timestamp * 1000
      ).toJSON()
    }

    return newEnt
  })

exports.sourceNodes = async (
  { boundActionCreators, getNode, hasNodeChanged, store, cache },
  { baseUrl }
) => {
  const { createNode, setPluginStatus, touchNode } = boundActionCreators

  // Touch existing Drupal nodes so Gatsby doesn't garbage collect them.
  _.values(store.getState().nodes)
    .filter(n => n.internal.type.slice(0, 8) === `drupal__`)
    .forEach(n => touchNode(n.id))

  // Fetch articles.
  console.time(`fetch Drupal data`)
  console.log(`Starting to fetch data from Drupal`)

  let lastFetched
  if (
    store.getState().status.plugins &&
    store.getState().status.plugins[`gatsby-source-drupal`]
  ) {
    lastFetched = store.getState().status.plugins[`gatsby-source-drupal`].status
      .lastFetched
  }

  const data = await axios.get(`${baseUrl}/api`)
  console.log(JSON.stringify(data.data, null, 4))
  const allData = await Promise.all(
    _.map(data.data.links, async (url, type) => {
      if (type === `self`) return
      if (!url) return
      if (!type) return
      const getNext = async (url, data = []) => {
        const d = await axios.get(url)
        data = data.concat(d.data.data)
        if (d.data.links.next) {
          data = await getNext(d.data.links.next, data)
        }

        return data
      }

      const data = await getNext(url)

      return {
        type,
        data,
      }
    })
  )

  // Make list of all IDs so we can check against that when creating
  // relationships.
  const ids = {}
  _.each(allData, contentType => {
    if (!contentType) return
    _.each(contentType.data, datum => {
      ids[datum.id] = true
    })
  })

  // Create back references
  const backRefs = {}
  _.each(allData, contentType => {
    if (!contentType) return
    _.each(contentType.data, datum => {
      if (datum.relationships) {
        _.each(datum.relationships, (v, k) => {
          if (!v.data) return
          if (ids[v.data.id]) {
            if (!backRefs[v.data.id]) {
              backRefs[v.data.id] = []
            }
            backRefs[v.data.id].push({ id: datum.id, type: datum.type })
          }
        })
      }
    })
  })

  // Process nodes
  const nodes = []
  _.each(allData, contentType => {
    if (!contentType) return

    _.each(contentType.data, datum => {
      const node = {
        id: datum.id,
        parent: null,
        children: [],
        ...datum.attributes,
        internal: {
          type: datum.type.replace(/-|__|:|\.|\s/g, `_`),
        },
      }

      // Add relationships
      if (datum.relationships) {
        node.relationships = {}
        _.each(datum.relationships, (v, k) => {
          if (!v.data) return
          if (ids[v.data.id]) {
            node.relationships[`${k}___NODE`] = v.data.id
          }
          // Add back reference relationships.
          if (backRefs[datum.id]) {
            backRefs[datum.id].forEach(
              ref => (node.relationships[`${ref.type}___NODE`] = ref.id)
            )
          }
        })
      }
      node.internal.contentDigest = createContentDigest(node)
      nodes.push(node)
    })
  })

  // Download all files.
  await Promise.all(
    nodes.map(async node => {
      let fileNode
      if (node.internal.type === `files`) {
        try {
          fileNode = await createRemoteFileNode({
            url: node.uri,
            store,
            cache,
            createNode,
          })
        } catch (e) {
          // Ignore
        }
        if (fileNode) {
          node.localFile___NODE = fileNode.id
        }
      }
    })
  )

  nodes.forEach(n => createNode(n))

  // process.exit()

  // let url
  // if (lastFetched) {
  // url = `${baseUrl}/jsonapi/node/article?filter[new-content][path]=changed&filter[new-content][value]=${parseInt(
  // new Date(lastFetched).getTime() / 1000
  // ).toFixed(
  // 0
  // )}&filter[new-content][operator]=%3E&page[offset]=0&page[limit]=10`
  // } else {
  // url = `${baseUrl}/jsonapi/node/article`
  // }

  // let result
  // try {
  // result = await axios.get(url)
  // } catch (e) {
  // console.log(`error fetching articles`, e)
  // }

  // console.log(`articles fetched`, result.data.data.length)

  // setPluginStatus({
  // status: {
  // lastFetched: new Date().toJSON(),
  // },
  // })

  // console.timeEnd(`fetch Drupal data`)

  // const nodes = processEntities(result.data.data)
  // nodes.forEach((node, i) => {
  // const gatsbyNode = {
  // ...node,
  // children: [],
  // parent: `__SOURCE__`,
  // internal: {
  // ...node.internal,
  // type: makeTypeName(node.internal.type),
  // },
  // author___NODE: result.data.data[i].relationships.uid.data.id,
  // }

  // // Get content digest of node.
  // const contentDigest = crypto
  // .createHash(`md5`)
  // .update(JSON.stringify(gatsbyNode))
  // .digest(`hex`)

  // gatsbyNode.internal.contentDigest = contentDigest

  // createNode(gatsbyNode)
  // })

  // // Fetch users.
  // const userUrl = `${baseUrl}/jsonapi/user/user`
  // const userResult = await axios.get(userUrl)
  // const users = processEntities(userResult.data.data)
  // await Promise.all(
  // users.map(
  // (user, i) =>
  // new Promise(resolve => {
  // const gatsbyUser = {
  // ...user,
  // children: [],
  // parent: `__SOURCE__`,
  // internal: {
  // type: makeTypeName(user.internal.type),
  // },
  // }

  // if (gatsbyUser.uid === 1) {
  // resolve()
  // return
  // }

  // axios
  // .get(
  // userResult.data.data[i].relationships.user_picture.links.related,
  // { timeout: 20000 }
  // )
  // .catch(() => console.log(`fail fetch`, gatsbyUser))
  // .then(pictureResult => {
  // gatsbyUser.picture = `${baseUrl}${pictureResult.data.data
  // .attributes.url}`

  // gatsbyUser.internal.contentDigest = contentDigest

  // createNode(gatsbyUser)

  // resolve()
  // })
  // })
  // )
  // )
}
