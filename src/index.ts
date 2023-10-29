import express from 'express';
import path from 'path'
import {auth} from 'express-openid-connect'
import https from 'https'
import fs from 'fs'
import dotenv from 'dotenv'
import pool from './databaseConfig'
import tables from './tables'


const app = express();
const externalUrl = process.env.RENDER_EXTERNAL_URL
const PORT = externalUrl && process.env.PORT ? parseInt(process.env.PORT) : 4080;
dotenv.config()

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true })); 
app.set("views", path.join(__dirname, "views"));
app.set('view engine', 'pug');

const config = {
  authRequired : false,
  idpLogout : true,
  secret: process.env.SECRET,
  baseURL: externalUrl || `https://localhost:${PORT}`,
  clientID: process.env.CLIENT_ID,
  issuerBaseURL: 'https://web-labos.eu.auth0.com',
  clientSecret: process.env.CLIENT_SECRET,
  authorizationParams: {
    response_type: 'code'
  }
};

app.use(auth(config))

app.get('/',  function (req, res) {
  let username : string | undefined
  if (req.oidc.isAuthenticated()) {
    username = req.oidc.user?.name ?? req.oidc.user?.sub
  }
  res.render('index.pug', {username});
});

app.post('/updateTable', async (req, res) => {
    //first parameter is result, second is matchId and third is idOfCompetition
    const data = req.body.option.split(",");
    await pool.query(`UPDATE pairs SET result = ${data[0]} WHERE matchid = ${data[1]} AND idofcompetition = ${data[2]}`);
    let linkOfCompetition = "/updateCompetition?param="+data[2]
    res.redirect(linkOfCompetition)
})

//!!!!!!!!!!!!!!
app.get("/competition", async function (req, res) {
  let newDataSorted = []
  pool.connect()
  try {
    const competitors = await pool.query('SELECT * FROM competitors');
    const pairsTable = await pool.query(`SELECT * FROM pairs`);
    var competitions = await pool.query(`SELECT * FROM competitions`);

    let helpArray1 = []
    let helpArray2 = []

    let index = competitors.rows[0].fk_id
    let fk_ids = new Set()

    //spliting competitors by different ids of competition
    for (let i = 0; i < competitors.rows.length; ++i) {
      let newIndex = competitors.rows[i].fk_id
      fk_ids.add(newIndex);
      if (index != newIndex) {
        helpArray1.push(helpArray2)
        helpArray2 = []
        index = newIndex
        helpArray2.push(competitors.rows[i])
      } else {
        helpArray2.push(competitors.rows[i])
        if (i == competitors.rows.length - 1) helpArray1.push(helpArray2)
      }
    }

    helpArray1 = []
    let competitorsFromOneTable = []
    let round = [] // all rounds of each competition

    const values = fk_ids.values();
    for (let k = 0; k < fk_ids.size; ++k) {
      const obj = values.next()
      competitorsFromOneTable = competitors.rows.filter(items => items.fk_id === obj.value);
      round = pairsTable.rows.filter(items => items.idofcompetition === obj.value);
      for (let i = 0; i < round.length; ++i) {
        if (round[i].result == 1) {
          competitorsFromOneTable[round[i].pair1 - 1].points = competitorsFromOneTable[round[i].pair1 - 1].points + 3;
          competitorsFromOneTable[round[i].pair1 - 1].victory = competitorsFromOneTable[round[i].pair1 - 1].victory + 1;
          competitorsFromOneTable[round[i].pair2 - 1].losses = competitorsFromOneTable[round[i].pair2 - 1].losses + 1;

        } else if (round[i].result == 2) {
          competitorsFromOneTable[round[i].pair1 - 1].points = competitorsFromOneTable[round[i].pair1 - 1].points + 1;
          competitorsFromOneTable[round[i].pair2 - 1].points = competitorsFromOneTable[round[i].pair2 - 1].points + 1;
          competitorsFromOneTable[round[i].pair1 - 1].tied = competitorsFromOneTable[round[i].pair1 - 1].tied + 1;
          competitorsFromOneTable[round[i].pair2 - 1].tied = competitorsFromOneTable[round[i].pair2 - 1].tied + 1;

        } else if (round[i].result == 3) {
          competitorsFromOneTable[round[i].pair2 - 1].points = competitorsFromOneTable[round[i].pair2 - 1].points + 3;
          competitorsFromOneTable[round[i].pair1 - 1].losses = competitorsFromOneTable[round[i].pair1 - 1].losses + 1;
          competitorsFromOneTable[round[i].pair2 - 1].victory = competitorsFromOneTable[round[i].pair2 - 1].victory + 1;
        }
       }
       helpArray1.push(competitorsFromOneTable)
    }
    for (let i = 0; i < helpArray1.length; ++i) {
      newDataSorted.push(helpArray1[i].sort((a, b) => parseFloat(b.points) - parseFloat(a.points)))
    }
  } catch(err) {
    console.log(err)
  }

  let authID = [] // ids of all competition that current logged user has created
  const ids = await pool.query(`SELECT * FROM users WHERE email = '${req.oidc.user?.email}'`);
  if (ids === undefined) {
    authID.push(0)
  } else {
    for (let i = 0; i < ids.rows.length; ++i) {
      authID.push(ids.rows[i].fk_id)
    }
  }

  let map = new Map() // map with keys and values -> row from competition table and belonging competitiors and their points
  let helpArray1 = [];
  for (let i = 0; i < newDataSorted.length; ++i) {
    for (let j = 0; j < newDataSorted[i].length; ++j) {
      helpArray1.push(newDataSorted[i][j])
    }
  }
  for (let i = 0; i < newDataSorted.length; ++i) {
    let idOfCompetition = newDataSorted[i][0].fk_id
    let competition = competitions.rows.find(item => item.id === idOfCompetition)
    let oneData = helpArray1.filter(items => items.fk_id === idOfCompetition);
    map.set(competition, oneData)
  }
  if (req.oidc.isAuthenticated()) {
    res.render("competition.pug", {newDataSorted, authID, competitions, map})
  } else {
    res.redirect(302, '/')
  }
})


app.get("/generate", function (req, res) {
  let err = undefined
  if (!req.oidc.isAuthenticated()) {
    res.redirect(302, "/")
  } else {
    res.render("generate.pug", {err})
  }
})

app.get("/updateCompetition", async function(req, res) {
  let url = req.url;
  let wholeUrl;
  if (externalUrl) {
    wholeUrl = externalUrl + url
  } else {
    wholeUrl = `https://localhost:${PORT}` + url
  }
  let idOfCompetition = url.substring(url.indexOf("=") + 1)
  let data = []
  let pairs = []
  try {
    const table = await pool.query(`SELECT * FROM pairs WHERE idofcompetition = ${idOfCompetition}`);
    pairs.push(table.rows)
  } catch(err) {
    console.log(err)
  }

  try {
    const table = await pool.query(`SELECT * FROM competitors WHERE fk_id = ${idOfCompetition}`);
    var name = await pool.query(`SELECT * FROM competitions WHERE id = ${idOfCompetition}`)
    data.push(table.rows)
  } catch(err) {
    console.log(err)
  }

  let round = pairs[0]
  let competitorsFromOneTable = data[0]

  for (let i = 0; i < round.length; ++i) {
    if (round[i].result == 1) {
      competitorsFromOneTable[round[i].pair1 - 1].points = competitorsFromOneTable[round[i].pair1 - 1].points + 3;
      competitorsFromOneTable[round[i].pair1 - 1].victory = competitorsFromOneTable[round[i].pair1 - 1].victory + 1;
      competitorsFromOneTable[round[i].pair2 - 1].losses = competitorsFromOneTable[round[i].pair2 - 1].losses + 1;

    } else if (round[i].result == 2) {
      competitorsFromOneTable[round[i].pair1 - 1].points = competitorsFromOneTable[round[i].pair1 - 1].points + 1;
      competitorsFromOneTable[round[i].pair2 - 1].points = competitorsFromOneTable[round[i].pair2 - 1].points + 1;
      competitorsFromOneTable[round[i].pair1 - 1].tied = competitorsFromOneTable[round[i].pair1 - 1].tied + 1;
      competitorsFromOneTable[round[i].pair2 - 1].tied = competitorsFromOneTable[round[i].pair2 - 1].tied + 1;

    } else if (round[i].result == 3) {
      competitorsFromOneTable[round[i].pair2 - 1].points = competitorsFromOneTable[round[i].pair2 - 1].points + 3;
      competitorsFromOneTable[round[i].pair1 - 1].losses = competitorsFromOneTable[round[i].pair1 - 1].losses + 1;
      competitorsFromOneTable[round[i].pair2 - 1].victory = competitorsFromOneTable[round[i].pair2 - 1].victory + 1;
    }
  }

  var onlyOnePair = round
  onlyOnePair.sort((a, b) => parseInt(a.matchid) - parseInt(b.matchid));

  var newData = competitorsFromOneTable.sort((a, b) => parseFloat(b.points) - parseFloat(a.points))

  let helpArray = Array.from(competitorsFromOneTable) // copy of an array
  var updatedCompetitors = helpArray.sort((a : any, b : any) => parseInt(a.idofcompetitor) - parseInt(b.idofcompetitor));

  let competition = name.rows[0]
  let check = true
  if (!req.oidc.isAuthenticated()) {
    url = undefined
    wholeUrl = undefined
    check = false
  }
  res.render("updateCompetition.pug", {updatedCompetitors, newData, onlyOnePair, competition, url, wholeUrl, check})
})


app.post('/makeCompetition', async (req, res) => {
  const nameOfCompetition : string = req.body.name
  const competitors : string = req.body.competitors
  const typeOfCompetition = req.body.typeOfCompetition

  try {
    if (nameOfCompetition.length < 1) throw new Error("Morate unijeti ime natjecanja")
    if (competitors.indexOf(';') < 0) throw new Error("Natjecatelji moraju biti odvojeni s ';'")
    var allCompetitors = competitors.split(';')
    if (allCompetitors.length < 4 || allCompetitors.length > 8) throw new Error("Možete unijeti samo od 4 do 8 natjecatelja")

    //beginning of transaction
    await pool.query('BEGIN');
    try {
      await pool.query(`INSERT INTO "competitions" (name, typeofcompetition) VALUES ('${nameOfCompetition}', ${typeOfCompetition});`);
    } catch(err) {
      throw new Error("This name already exist! Try something else.")
    }
    const newCompetition = await pool.query(`SELECT * FROM competitions WHERE name = '${nameOfCompetition}'`);
    let newlyAddedId = newCompetition.rows[0].id
    await pool.query(`INSERT INTO "users" (email, fk_id) VALUES ('${req.oidc.user?.email}', ${newlyAddedId});`);

    for (let i = 0; i < allCompetitors.length; ++i) {
      await pool.query(`INSERT INTO "competitors" (name, fk_id, victory, tied, losses, points) VALUES ('${allCompetitors[i]}', ${newlyAddedId}, 0, 0, 0, 0)`);
    }

    let keys = tables(allCompetitors.length)
    for (let j = 0; j < keys.length; ++j) {
      for (let k = 0; k < keys[j].length / 2; ++k) {
         await pool.query(`INSERT INTO pairs (idofcompetition, pair1, pair2, result) VALUES (${newlyAddedId}, ${keys[j][k]}, ${keys[j][keys[j].length / 2 + k]}, 0)`);
      }
    }
    //end of transaction
    await pool.query('COMMIT');
    res.redirect(302, '/competition');
  } catch (err) {
    await pool.query('ROLLBACK');
    res.render('generate.pug', {err});
    }
});
if (externalUrl) {
  const hostname = '0.0.0.0'
  app.listen(PORT, hostname, () => {
    console.log(`Server locally running at https://${hostname}:${PORT}/ and from outside on ${externalUrl}`)
  })
} else {
  https.createServer({
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.cert')
  }, app).listen(PORT, function() {
    console.log(`Server is running on https://localhost:${PORT}`);
  })
}