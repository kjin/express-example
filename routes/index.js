var models  = require('../models');
var express = require('express');
var router  = express.Router();

router.get('/', function(req, res) {
  models.User.findAll({
    include: [ models.Task ]
  }).then(function(users) {
    if (req.query.json) {
      res.json(users);
    } else {
      res.render('index', {
        title: 'Sequelize: Express Example',
        users: users
      });
    }
  });
});

module.exports = router;
